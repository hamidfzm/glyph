//! IPC surface of the settings repo. No command takes a path: every folder
//! comes from the app's own data dir, so the renderer can point neither
//! libgit2 nor a write anywhere else. An operation that changes the clone
//! runs on a blocking thread holding the repo's lock; another one meanwhile
//! gets `Busy`.

use tauri::{AppHandle, Manager, Runtime, State};

use crate::grants::GrantRegistry;
use crate::sync::git::{self, BoundToken, ConflictPick};
use crate::sync::ops::validate_remote_url;
use crate::sync::{CommitAuthorHint, CommitIdentity, StatusReport, SyncError};

use super::config::{load_config, Phase, RepoPaths, SettingsRepoConfig};
use super::flow::{self, SettingsSyncOutcome, SetupChoice};
use super::local::TauriLocal;
use super::plugins::PluginPlan;
use super::state::{try_hold, Locations, SettingsSyncState};

fn locations<R: Runtime>(
    app: &AppHandle<R>,
    state: &SettingsSyncState,
) -> Result<Locations, SyncError> {
    if let Some(locations) = state.locations() {
        return Ok(locations.clone());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| SyncError::Backend(e.to_string()))?;
    Ok(Locations {
        app_data,
        settings_store: crate::setup::SETTINGS_STORE.into(),
        plugins_store: crate::setup::PLUGINS_STORE.into(),
        plugins_root: crate::commands::plugins::plugins_root(app).map_err(SyncError::Backend)?,
    })
}

/// Judge the clone's own files before libgit2 opens it: on Windows a
/// repository can name a network path that opening it connects to.
fn judge_clone(grants: &GrantRegistry, paths: &RepoPaths) -> Result<(), SyncError> {
    #[cfg(windows)]
    {
        let judge = |path: &std::path::Path| grants.refuse_remote(path.to_string_lossy().as_ref());
        git::refuse_remote_pointers_with_submodules(&paths.repo(), &judge)
            .map_err(SyncError::Io)?;
    }
    #[cfg(not(windows))]
    let _ = (grants, paths);
    Ok(())
}

/// Run `work` on a blocking thread, holding the repo's lock when `exclusive`.
async fn on_repo<R, T, F>(
    app: AppHandle<R>,
    state: &SettingsSyncState,
    exclusive: bool,
    work: F,
) -> Result<T, SyncError>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(&RepoPaths, &TauriLocal<R>, Option<BoundToken>) -> Result<T, SyncError>
        + Send
        + 'static,
{
    let locations = locations(&app, state)?;
    let paths = RepoPaths::under(&locations.app_data);
    let token = state.token();
    let lock = state.lock();
    let local = TauriLocal::new(app, locations);
    tauri::async_runtime::spawn_blocking(move || {
        let _held = if exclusive {
            Some(try_hold(&lock)?)
        } else {
            None
        };
        work(&paths, &local, token)
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

fn paths_of<R: Runtime>(
    app: &AppHandle<R>,
    state: &SettingsSyncState,
) -> Result<RepoPaths, SyncError> {
    Ok(RepoPaths::under(&locations(app, state)?.app_data))
}

#[tauri::command]
pub async fn settings_sync_get_config<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<Option<SettingsRepoConfig>, SyncError> {
    load_config(&paths_of(&app, &state)?)
}

/// Connect to a remote. A token, when given, is bound to the remote's host
/// and kept only once the connect succeeds.
#[tauri::command]
pub async fn settings_sync_connect<R: Runtime>(
    remote_url: String,
    branch: String,
    author: Option<CommitIdentity>,
    token: Option<String>,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<SettingsSyncOutcome, SyncError> {
    validate_remote_url(&remote_url)?;
    let token = match token.filter(|t| !t.trim().is_empty()) {
        Some(token) => Some(BoundToken {
            host: git::https_authority(&remote_url).ok_or_else(|| {
                SyncError::InvalidState("a token works only with an https:// remote".into())
            })?,
            token,
        }),
        None => None,
    };
    let config = SettingsRepoConfig {
        remote_url,
        branch,
        author,
        phase: Phase::Active,
    };
    let bound = token.clone();
    let outcome = on_repo(app, &state, true, move |paths, local, _| {
        flow::connect(paths, local, config, bound)
    })
    .await?;
    match token {
        Some(token) => state.set_token(token.token, token.host),
        None => state.clear_token(),
    }
    Ok(outcome)
}

/// Replace the token, bound to the connected remote's host.
#[tauri::command]
pub async fn settings_sync_set_token<R: Runtime>(
    token: String,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<(), SyncError> {
    let config = load_config(&paths_of(&app, &state)?)?.ok_or(SyncError::NotConfigured)?;
    let host = git::https_authority(&config.remote_url).ok_or_else(|| {
        SyncError::InvalidState("a token works only with an https:// remote".into())
    })?;
    state.set_token(token, host);
    Ok(())
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
    let repo = paths_of(&app, &state)?.repo();
    Ok(crate::sync::ops::default_author(&repo.to_string_lossy()))
}

#[tauri::command]
pub async fn settings_sync_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<StatusReport, SyncError> {
    judge_clone(&grants, &paths_of(&app, &state)?)?;
    on_repo(app, &state, false, |paths, _, token| {
        flow::status(paths, token)
    })
    .await
}

#[tauri::command]
pub async fn settings_sync_run<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<SettingsSyncOutcome, SyncError> {
    judge_clone(&grants, &paths_of(&app, &state)?)?;
    on_repo(app, &state, true, flow::run).await
}

/// The first-connect answer. It starts from a fresh clone, so there is no
/// existing repository to judge.
#[tauri::command]
pub async fn settings_sync_choose<R: Runtime>(
    choice: SetupChoice,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<SettingsSyncOutcome, SyncError> {
    on_repo(app, &state, true, move |paths, local, token| {
        flow::choose(paths, local, token, choice)
    })
    .await
}

#[tauri::command]
pub async fn settings_sync_resolve<R: Runtime>(
    picks: Vec<ConflictPick>,
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<SettingsSyncOutcome, SyncError> {
    judge_clone(&grants, &paths_of(&app, &state)?)?;
    on_repo(app, &state, true, move |paths, local, token| {
        flow::resolve(paths, local, token, &picks)
    })
    .await
}

#[tauri::command]
pub async fn settings_sync_plugin_plan<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
    grants: State<'_, GrantRegistry>,
) -> Result<PluginPlan, SyncError> {
    judge_clone(&grants, &paths_of(&app, &state)?)?;
    on_repo(app, &state, false, |paths, local, _| {
        flow::plugin_plan(paths, local)
    })
    .await
}

/// Forget the remote: the token, the config and the clone go; this
/// machine's settings and plugins stay.
#[tauri::command]
pub async fn settings_sync_disconnect<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SettingsSyncState>,
) -> Result<(), SyncError> {
    on_repo(app, &state, true, |paths, _, _| flow::forget(paths)).await?;
    state.clear_token();
    Ok(())
}
