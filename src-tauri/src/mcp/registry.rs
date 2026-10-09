//! The tools, and a way to call them that knows nothing of any transport: the
//! stdio adapter drives it today, and an in-app caller can drive it the same
//! way. Handlers never read stdin, write stdout, or exit.

use std::panic::AssertUnwindSafe;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use super::session::OpenState;
use super::{launch, link_tools, move_tools, note_tools, vault_tools, write_tools};
use crate::data_dir::Editing;
use crate::grants::GrantRegistry;
use crate::vault::VaultStore;

/// Everything a call reads besides its arguments.
pub struct Session<'a> {
    pub grants: &'a GrantRegistry,
    pub vaults: &'a VaultStore,
    /// What the user has open: read from the persisted stores by the stdio
    /// adapter before each call, passed live by an in-app caller.
    pub open: &'a OpenState,
    /// What the running app's windows hold, asked when a call is about to
    /// write: a list read as the call began is stale once the user has been
    /// asked something, and misses a folder allowed since.
    pub editing: &'a dyn Fn() -> Editing,
    /// The Glyph binary that `open_in_glyph` and `export` start.
    pub exe: &'a Path,
    /// Asks the user to let the session serve a folder it was not given;
    /// `None` when nothing can ask them.
    pub allow_vault: Option<&'a AllowVault<'a>>,
}

/// Asks the user to let the session serve `root`: Ok once they have, and
/// later calls list it too, else why not.
pub type AllowVault<'a> = dyn Fn(&str) -> Result<(), String> + 'a;

/// What a tool does beyond answering, which a client uses to decide what
/// needs the user's approval.
#[derive(Clone, Copy, PartialEq)]
pub enum Effect {
    ReadOnly,
    /// Starts the app, or brings a note up in the running one.
    Launches,
    /// Writes a file, replacing one already there.
    Writes,
    /// Changes a note the user wrote. Off until the user turns that tool on.
    Edits,
}

pub struct ToolDef {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub input_schema: fn() -> Value,
    pub effect: Effect,
    pub(super) handler: fn(&Session, Value) -> Result<Value, String>,
}

#[derive(Debug, PartialEq)]
pub enum ToolError {
    /// No tool has this name.
    Unknown(String),
    /// The tool ran and refused, with a message meant for the model.
    Failed(String),
}

static TOOLS: [ToolDef; 17] = [
    vault_tools::VAULT_CONTEXT,
    note_tools::RESOLVE_LINK,
    note_tools::READ_NOTE,
    note_tools::NOTE_INFO,
    link_tools::BACKLINKS,
    link_tools::GRAPH_NEIGHBORS,
    vault_tools::VAULT_REPORT,
    vault_tools::LIST_TAGS,
    vault_tools::NOTES_BY_TAG,
    link_tools::READ_CANVAS,
    launch::OPEN_IN_GLYPH,
    launch::EXPORT,
    write_tools::PATCH_NOTE,
    write_tools::SET_PROPERTY,
    write_tools::UPDATE_TASK,
    move_tools::RENAME_NOTE,
    move_tools::MOVE_NOTE,
];

/// The tools a session with `open` offers.
pub fn list(open: &OpenState) -> impl Iterator<Item = &'static ToolDef> + '_ {
    TOOLS.iter().filter(|tool| tool.is_on(open))
}

/// The tools that change notes which `open` has turned on, by name.
pub fn edits_on(open: &OpenState) -> Vec<&'static str> {
    let edits = list(open).filter(|tool| tool.effect == Effect::Edits);
    edits.map(|tool| tool.name).collect()
}

/// The most one result may carry, serialized. Listings and text are cut far
/// below this; it bounds whatever a note's own content could still inflate.
const MAX_RESULT_BYTES: usize = 1024 * 1024;

pub fn dispatch(name: &str, args: Value, session: &Session) -> Result<String, ToolError> {
    let tool = TOOLS
        .iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| ToolError::Unknown(name.to_string()))?;
    // Checked here and not only where the tools are listed: a client can call
    // a name it was never offered.
    if !tool.is_on(session.open) {
        return Err(ToolError::Failed(format!(
            "{name} is turned off. It changes notes, so the user has to turn it on in Glyph: Settings, AI, Agent tools."
        )));
    }
    // A client may leave out the arguments of a tool that takes none.
    let args = if args.is_null() { json!({}) } else { args };
    run_tool(tool, session, args)
}

/// One handler, run so that neither a bug that panics nor an outsized answer
/// ends the session. The answer comes as JSON text, ready to send.
fn run_tool(tool: &ToolDef, session: &Session, args: Value) -> Result<String, ToolError> {
    let ran = std::panic::catch_unwind(AssertUnwindSafe(|| {
        (tool.handler)(session, args).map(|answer| answer.to_string())
    }));
    let text = ran
        .unwrap_or_else(|_| Err(format!("{} failed unexpectedly", tool.name)))
        .map_err(ToolError::Failed)?;
    if text.len() > MAX_RESULT_BYTES {
        return Err(ToolError::Failed(format!(
            "the answer is over {} KB; ask for less, such as one section",
            MAX_RESULT_BYTES / 1024
        )));
    }
    Ok(text)
}

impl ToolDef {
    fn is_on(&self, open: &OpenState) -> bool {
        self.effect != Effect::Edits || open.write_tools.iter().any(|on| on == self.name)
    }

    /// This tool's entry in a `tools/list` result.
    pub fn describe(&self) -> Value {
        json!({
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": (self.input_schema)(),
            "annotations": {
                "readOnlyHint": self.effect == Effect::ReadOnly,
                "destructiveHint": matches!(self.effect, Effect::Writes | Effect::Edits),
                "openWorldHint": false,
            },
        })
    }
}

/// A call's arguments, or a message the model can correct them from.
pub(super) fn arguments<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|err| format!("invalid arguments: {err}"))
}

#[cfg(test)]
mod tests {
    use super::super::test_support::Harness;
    use super::*;

    fn tool(handler: fn(&Session, Value) -> Result<Value, String>) -> ToolDef {
        ToolDef {
            name: "probe",
            title: "Probe",
            description: "",
            input_schema: TOOLS[0].input_schema,
            effect: Effect::ReadOnly,
            handler,
        }
    }

    #[test]
    fn a_panic_or_an_outsized_answer_is_a_refusal_not_the_end() {
        let h = Harness::new("registry_probe");
        let session = h.session();
        let panics = tool(|_, _| panic!("a handler bug"));
        let floods = tool(|_, _| Ok(json!("x".repeat(MAX_RESULT_BYTES))));
        let answers = tool(|_, args| Ok(args));

        let refused = |tool: &ToolDef, reason: &str| {
            matches!(run_tool(tool, &session, json!({})),
                Err(ToolError::Failed(message)) if message.contains(reason))
        };
        assert!(refused(&panics, "failed unexpectedly"));
        assert!(refused(&floods, "ask for less"));
        assert_eq!(
            run_tool(&answers, &session, json!({ "a": 1 })),
            Ok(r#"{"a":1}"#.to_string())
        );
    }
}
