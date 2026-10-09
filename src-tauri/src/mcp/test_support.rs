//! The harness the MCP test modules share: a fixture vault and a session
//! over it, with every tool driven through the registry in-process.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use super::registry::{dispatch, AllowVault, Session, ToolError};
use super::session::OpenState;
use crate::data_dir::{Editing, OpenDocuments};
use crate::grants::GrantRegistry;
use crate::vault::test_support::{fixture_vault, in_vault, relative};
use crate::vault::{Vault, VaultStore};

/// The tools that change notes, in the order the registry lists them.
pub(super) const WRITE_TOOLS: [&str; 5] = [
    "patch_note",
    "set_property",
    "update_task",
    "rename_note",
    "move_note",
];

pub(super) struct Harness {
    pub(super) root: PathBuf,
    pub(super) grants: GrantRegistry,
    pub(super) store: VaultStore,
    pub(super) open: OpenState,
    /// What the running app's windows hold, as a call about to write is told.
    app: Box<dyn Fn() -> Editing>,
    pub(super) exe: PathBuf,
    /// The user's answer when a call asks for a folder; `None` for a client
    /// that cannot ask.
    pub(super) allow: Option<Box<AllowVault<'static>>>,
}

impl Harness {
    pub(super) fn new(name: &str) -> Self {
        Self::over(fixture_vault(name))
    }

    pub(super) fn over(root: PathBuf) -> Self {
        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();
        let open = OpenState {
            roots: vec![root.to_string_lossy().to_string()],
            ..OpenState::default()
        };
        Harness {
            root,
            grants,
            store: VaultStore::default(),
            open,
            app: Box::new(|| Editing::Closed),
            // Nothing by this name exists, so a launch fails instead of
            // starting anything.
            exe: PathBuf::from("glyph-tests-start-nothing"),
            allow: None,
        }
    }

    pub(super) fn path(&self, relative: &str) -> String {
        in_vault(&self.root, relative)
    }

    /// A vault with every tool that changes notes turned on.
    pub(super) fn writing(name: &str) -> Self {
        let mut h = Self::new(name);
        h.turn_on(&WRITE_TOOLS);
        h
    }

    /// Turn on the tools that change notes, as the user does in the settings.
    pub(super) fn turn_on(&mut self, tools: &[&str]) {
        self.open.write_tools = tools.iter().map(|tool| tool.to_string()).collect();
    }

    /// The app is running with these notes open, and these among them unsaved.
    pub(super) fn editing(&mut self, open: &[&str], unsaved: &[&str]) {
        let paths = |notes: &[&str]| notes.iter().map(|note| self.path(note)).collect();
        self.editing_paths(paths(open), paths(unsaved));
    }

    /// [`Self::editing`] for files named in full, wherever they are.
    pub(super) fn editing_paths(&mut self, open: Vec<String>, unsaved: Vec<String>) {
        let documents = OpenDocuments { open, unsaved };
        self.app = Box::new(move || Editing::Open(documents.clone()));
        self.open.app_running = true;
    }

    /// The app is running and has not said what it has open.
    pub(super) fn running_unreported(&mut self) {
        self.app = Box::new(|| Editing::Unknown);
        self.open.app_running = true;
    }

    /// The user turned Auto Reload off in the settings.
    pub(super) fn auto_reload_off(&mut self) {
        self.open.auto_reload_off = true;
    }

    /// Grant a second folder, as a session serving several vaults holds.
    pub(super) fn grant(&self, folder: &std::path::Path) {
        self.grants.grant_workspace(folder).unwrap();
    }

    pub(super) fn read(&self, relative: &str) -> String {
        fs::read_to_string(self.path(relative)).unwrap()
    }

    pub(super) fn write(&self, relative: &str, content: &str) {
        fs::write(self.path(relative), content).unwrap();
    }

    pub(super) fn session(&self) -> Session<'_> {
        Session {
            grants: &self.grants,
            vaults: &self.store,
            open: &self.open,
            editing: &*self.app,
            exe: &self.exe,
            allow_vault: self.allow.as_deref(),
        }
    }

    pub(super) fn call(&self, tool: &str, args: Value) -> Result<Value, ToolError> {
        let text = dispatch(tool, args, &self.session())?;
        Ok(serde_json::from_str(&text).expect("a tool answers in JSON"))
    }

    pub(super) fn ok(&self, tool: &str, args: Value) -> Value {
        self.call(tool, args.clone())
            .unwrap_or_else(|err| panic!("{tool}({args}) failed: {err:?}"))
    }

    /// Why the tool refused. A tool that does not exist is not a refusal.
    pub(super) fn refused(&self, tool: &str, args: Value) -> String {
        let asked = format!("{tool}({args}) should have refused");
        let refusal = self.call(tool, args).expect_err(&asked);
        assert!(
            matches!(refusal, ToolError::Failed(_)),
            "{asked}: {refusal:?}"
        );
        let (ToolError::Failed(message) | ToolError::Unknown(message)) = refusal;
        message
    }

    /// A fresh build of the same folder: the answer the app would give.
    pub(super) fn index(&self) -> Vault {
        Vault::build(&self.root).unwrap()
    }

    pub(super) fn relative(&self, path: &Value) -> String {
        relative(&self.root, path.as_str().unwrap())
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
