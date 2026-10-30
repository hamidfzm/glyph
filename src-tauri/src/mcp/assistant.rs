//! The in-app assistant's way to the tools: the read-only ones, run in-process
//! against what the calling window has open. No call names a root: the roots
//! and tabs are the window's own report, kept only where the grants admit
//! them, so a model reading one window's notes cannot reach another's.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use super::registry::{self, Caller, Session, ToolError};
use super::session::{OpenState, OpenTab};
use crate::data_dir::Editing;
use crate::grants::GrantRegistry;
use crate::vault::VaultStore;
use crate::windows::WindowRegistry;

/// The tools the assistant may offer a model, as `tools/list` describes them.
#[tauri::command]
pub fn assistant_tools() -> Result<Vec<Value>, String> {
    Ok(registry::read_only().map(|tool| tool.describe()).collect())
}

/// Run one call a model made. A refusal comes back as the error, worded for
/// the model. `active_note` is the note in front of the user, kept only when
/// it is one of the window's reported tabs.
#[tauri::command]
pub async fn assistant_tool_call<R: Runtime>(
    window: WebviewWindow<R>,
    name: String,
    arguments: Value,
    active_note: Option<String>,
) -> Result<String, String> {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    // A first call builds the vault's index, which walks the whole workspace.
    tauri::async_runtime::spawn_blocking(move || {
        call_for_window(&app, &label, &name, arguments, active_note)
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(super) fn call_for_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    name: &str,
    arguments: Value,
    active_note: Option<String>,
) -> Result<String, String> {
    let grants = app.state::<GrantRegistry>();
    let open = window_state(&app.state::<WindowRegistry>(), &grants, label, active_note);
    // Asked only by the edit tools, which `dispatch_read` never reaches; not
    // knowing refuses every write.
    let editing = || Editing::Unknown;
    let session = Session {
        grants: &grants,
        vaults: &app.state::<VaultStore>(),
        open: &open,
        editing: &editing,
        // Never started: `dispatch_read` refuses the tools that start it.
        exe: Path::new(""),
        allow_vault: None,
        caller: Caller::App,
    };
    registry::dispatch_read(name, arguments, &session).map_err(|err| match err {
        ToolError::Unknown(name) => format!("no tool is named {name}"),
        ToolError::Failed(message) => message,
    })
}

fn window_state(
    windows: &WindowRegistry,
    grants: &GrantRegistry,
    label: &str,
    active_note: Option<String>,
) -> OpenState {
    let (workspace, files) = windows.shown_in(label);
    let roots = workspace
        .into_iter()
        .filter(|root| grants.ensure_workspace(root).is_ok())
        .collect();
    let readable: Vec<String> = files
        .into_iter()
        .filter(|path| grants.ensure_readable(path).is_ok())
        .collect();
    // Compared, never looked up: the webview chose this path.
    let active_note = active_note.filter(|note| readable.contains(note));
    let tabs = readable
        .into_iter()
        .map(|path| OpenTab {
            kind: "file".to_string(),
            path,
        })
        .collect();
    OpenState {
        roots,
        app_running: true,
        active_note,
        tabs,
        // Empty whatever the settings say: a tool turned on for `glyph mcp`
        // is not the assistant's to call.
        write_tools: Vec::new(),
        ..OpenState::default()
    }
}
