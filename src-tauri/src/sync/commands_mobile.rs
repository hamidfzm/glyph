//! Mobile stand-ins for the sync command surface (see [`super::commands`]).
//!
//! The git backend (git2 + vendored OpenSSL) doesn't cross-compile for
//! android/ios, and folder workspaces don't exist on mobile (#79 scopes
//! mobile to single-file viewing). Read-style commands return benign empties
//! so mounting UI never errors; mutating commands report unavailability in
//! case one is ever reached.

use super::WorkspaceSyncConfig;

const NOT_AVAILABLE: &str = "Workspace sync is not available on mobile";

#[tauri::command]
pub fn sync_set_config(_config: WorkspaceSyncConfig) -> Result<(), String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_get_config(_workspace_path: String) -> Result<Option<WorkspaceSyncConfig>, String> {
    Ok(None)
}

#[tauri::command]
pub fn sync_remove_config(_workspace_path: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn sync_set_token(_workspace_path: String, _token: String) -> Result<(), String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_clear_token(_workspace_path: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn sync_init_repo(
    _workspace_path: String,
    _default_branch: Option<String>,
    _remote_url: Option<String>,
) -> Result<(), String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_clone_remote(
    _workspace_path: String,
    _remote_url: String,
    _token: Option<String>,
) -> Result<(), String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_set_origin(_workspace_path: String, _remote_url: String) -> Result<(), String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_commit_config(_workspace_path: String) -> Result<bool, String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_status(_workspace_path: String) -> Result<serde_json::Value, String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_run(
    _workspace_path: String,
    _message: Option<String>,
) -> Result<serde_json::Value, String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_default_author(_workspace_path: String) -> Result<serde_json::Value, String> {
    Err(NOT_AVAILABLE.into())
}

#[tauri::command]
pub fn sync_repo_present(_workspace_path: String) -> Result<bool, String> {
    Ok(false)
}
