//! IPC surface of the settings repo. Every command is a thin
//! `#[tauri::command]` wrapper around [`super::ops`]. The proc-macro emits
//! marshalling code for async commands that no call reaches, even over IPC,
//! so this file is excluded from codecov coverage; the logic lives in
//! `ops.rs` and is tested there.

use tauri::{AppHandle, Runtime, State};

use crate::grants::GrantRegistry;
use crate::sync::git::ConflictPick;
use crate::sync::{CommitAuthorHint, CommitIdentity, StatusReport, SyncError};

use super::config::SettingsRepoConfig;
use super::flow::{SettingsSyncOutcome, SetupChoice};
use super::ops;
use super::plugins::PluginPlan;
use super::state::SettingsSyncState;

#[tauri::command]
pub async fn settings_sync_get_config<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<Option<SettingsRepoConfig>, SyncError> {
    ops::config(&app, &state)
}

#[tauri::command]
pub async fn settings_sync_connect<R: Runtime>(
    remote_url: String,
    branch: String,
    author: Option<CommitIdentity>,
    token: Option<String>,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<SettingsSyncOutcome, SyncError> {
    ops::connect(app, &state, remote_url, branch, author, token).await
}

#[tauri::command]
pub async fn settings_sync_set_token<R: Runtime>(
    token: String,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<(), SyncError> {
    ops::set_token(&app, &state, token)
}

#[tauri::command]
pub async fn settings_sync_has_token(
    state: State<'_, SettingsSyncState>,
) -> Result<bool, SyncError> {
    state.has_token()
}

#[tauri::command]
pub async fn settings_sync_clear_token(
    state: State<'_, SettingsSyncState>,
) -> Result<(), SyncError> {
    state.clear_token();
    Ok(())
}

#[tauri::command]
pub async fn settings_sync_default_author<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<CommitAuthorHint, SyncError> {
    ops::default_author(&app, &state)
}

#[tauri::command]
pub async fn settings_sync_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<StatusReport, SyncError> {
    ops::status(app, &state, &grants).await
}

#[tauri::command]
pub async fn settings_sync_run<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<SettingsSyncOutcome, SyncError> {
    ops::run(app, &state, &grants).await
}

#[tauri::command]
pub async fn settings_sync_choose<R: Runtime>(
    choice: SetupChoice,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<SettingsSyncOutcome, SyncError> {
    ops::choose(app, &state, choice).await
}

#[tauri::command]
pub async fn settings_sync_resolve<R: Runtime>(
    picks: Vec<ConflictPick>,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<SettingsSyncOutcome, SyncError> {
    ops::resolve(app, &state, &grants, picks).await
}

#[tauri::command]
pub async fn settings_sync_plugin_plan<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<PluginPlan, SyncError> {
    ops::plugin_plan(app, &state, &grants).await
}

#[tauri::command]
pub async fn settings_sync_disconnect<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<(), SyncError> {
    ops::disconnect(app, &state).await
}
