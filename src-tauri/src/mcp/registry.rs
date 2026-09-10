//! The tools, and a way to call them that knows nothing of any transport: the
//! stdio adapter drives it today, and an in-app caller can drive it the same
//! way. Handlers never read stdin, write stdout, or exit.

use std::panic::AssertUnwindSafe;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use super::session::OpenState;
use super::{launch, link_tools, note_tools, vault_tools};
use crate::grants::GrantRegistry;
use crate::vault::VaultStore;

/// Everything a call reads besides its arguments.
pub struct Session<'a> {
    pub grants: &'a GrantRegistry,
    pub vaults: &'a VaultStore,
    /// What the user has open: read from the persisted stores by the stdio
    /// adapter before each call, passed live by an in-app caller.
    pub open: &'a OpenState,
    /// The Glyph binary that `open_in_glyph` and `export` start.
    pub exe: &'a Path,
}

/// What a tool does beyond answering, which a client uses to decide what
/// needs the user's approval.
#[derive(Clone, Copy, PartialEq)]
pub enum Effect {
    ReadOnly,
    /// Starts the app, or brings a note up in the running one.
    Launches,
    /// Writes a file, replacing one already there.
    Writes,
}

pub struct ToolDef {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub input_schema: fn() -> Value,
    pub effect: Effect,
    /// A tool that is off is neither listed nor callable. Every tool is on
    /// until per-tool settings exist.
    pub enabled: bool,
    pub(super) handler: fn(&Session, Value) -> Result<Value, String>,
}

#[derive(Debug, PartialEq)]
pub enum ToolError {
    /// No enabled tool has this name.
    Unknown(String),
    /// The tool ran and refused, with a message meant for the model.
    Failed(String),
}

static TOOLS: [ToolDef; 12] = [
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
];

pub fn list() -> impl Iterator<Item = &'static ToolDef> {
    TOOLS.iter().filter(|tool| tool.enabled)
}

/// The most one result may carry, serialized. Listings and text are cut far
/// below this; it bounds whatever a note's own content could still inflate.
const MAX_RESULT_BYTES: usize = 1024 * 1024;

pub fn dispatch(name: &str, args: Value, session: &Session) -> Result<Value, ToolError> {
    let tool = list()
        .find(|tool| tool.name == name)
        .ok_or_else(|| ToolError::Unknown(name.to_string()))?;
    // A client may leave out the arguments of a tool that takes none.
    let args = if args.is_null() { json!({}) } else { args };
    run_tool(tool, session, args)
}

/// One handler, run so that neither a bug that panics nor an outsized answer
/// ends the session.
fn run_tool(tool: &ToolDef, session: &Session, args: Value) -> Result<Value, ToolError> {
    let ran = std::panic::catch_unwind(AssertUnwindSafe(|| (tool.handler)(session, args)));
    let result = ran
        .unwrap_or_else(|_| Err(format!("{} failed unexpectedly", tool.name)))
        .map_err(ToolError::Failed)?;
    let size = serde_json::to_string(&result).map_or(0, |text| text.len());
    if size > MAX_RESULT_BYTES {
        return Err(ToolError::Failed(format!(
            "the answer is over {} KB; ask for less, such as one section",
            MAX_RESULT_BYTES / 1024
        )));
    }
    Ok(result)
}

impl ToolDef {
    /// This tool's entry in a `tools/list` result.
    pub fn describe(&self) -> Value {
        json!({
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": (self.input_schema)(),
            "annotations": {
                "readOnlyHint": self.effect == Effect::ReadOnly,
                "destructiveHint": self.effect == Effect::Writes,
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
    use super::*;

    fn tool(handler: fn(&Session, Value) -> Result<Value, String>) -> ToolDef {
        ToolDef {
            name: "probe",
            title: "Probe",
            description: "",
            input_schema: || json!({}),
            effect: Effect::ReadOnly,
            enabled: true,
            handler,
        }
    }

    #[test]
    fn a_panic_or_an_outsized_answer_is_a_refusal_not_the_end() {
        let (grants, vaults, open) = (
            GrantRegistry::default(),
            VaultStore::default(),
            OpenState::default(),
        );
        let session = Session {
            grants: &grants,
            vaults: &vaults,
            open: &open,
            exe: Path::new("glyph"),
        };
        let panics = tool(|_, _| panic!("a handler bug"));
        let floods = tool(|_, _| Ok(json!("x".repeat(MAX_RESULT_BYTES))));
        let answers = tool(|_, args| Ok(args));

        let refused = |tool: &ToolDef| match run_tool(tool, &session, json!({})) {
            Err(ToolError::Failed(message)) => message,
            other => panic!("expected a refusal, got {other:?}"),
        };
        assert!(refused(&panics).contains("failed unexpectedly"));
        assert!(refused(&floods).contains("ask for less"));
        assert_eq!(
            run_tool(&answers, &session, json!({ "a": 1 })),
            Ok(json!({ "a": 1 }))
        );
    }
}
