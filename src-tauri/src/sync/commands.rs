//! Tauri command surface for cloud sync.
//!
//! Every function in this file is a thin `#[tauri::command]` wrapper
//! around an async helper in [`super::ops`]. The proc-macro emits IPC
//! marshalling code that isn't reachable from a direct function call,
//! so this file is excluded from codecov coverage; the real logic lives
//! in `ops.rs` and is fully tested there.

use tauri::State;

use super::backend::{StatusReport, SyncResult};
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;
use super::ops;
use super::state::SyncState;

#[tauri::command]
pub async fn sync_set_config(
    config: WorkspaceSyncConfig,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    ops::set_config(&state, config);
    Ok(())
}

#[tauri::command]
pub async fn sync_get_config(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<Option<WorkspaceSyncConfig>, SyncError> {
    Ok(ops::get_config(&state, &workspace_path))
}

#[tauri::command]
pub async fn sync_remove_config(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    ops::remove_config(&state, &workspace_path);
    Ok(())
}

#[tauri::command]
pub async fn sync_set_token(
    workspace_path: String,
    token: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    ops::set_token(&state, workspace_path, token);
    Ok(())
}

#[tauri::command]
pub async fn sync_clear_token(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    ops::clear_token(&state, &workspace_path);
    Ok(())
}

#[tauri::command]
pub async fn sync_init_repo(
    workspace_path: String,
    default_branch: Option<String>,
    remote_url: Option<String>,
) -> Result<(), SyncError> {
    ops::init_repo(workspace_path, default_branch, remote_url).await
}

#[tauri::command]
pub async fn sync_clone_remote(
    workspace_path: String,
    remote_url: String,
    token: Option<String>,
) -> Result<(), SyncError> {
    ops::clone_remote(workspace_path, remote_url, token).await
}

#[tauri::command]
pub async fn sync_status(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<StatusReport, SyncError> {
    ops::run_status(&state, &workspace_path).await
}

#[tauri::command]
pub async fn sync_run(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<SyncResult, SyncError> {
    ops::run_sync(&state, &workspace_path).await
}

#[cfg(test)]
mod tests {
    //! Each wrapper is one line of `ops::* (...).await`, but they still
    //! need exercising so the `pub async fn ...` body line is covered.
    //! Tests build a mock app, register `SyncState`, and call the
    //! wrappers directly via `Manager::state()`. Real IPC routing (the
    //! proc-macro-emitted `__cmd__sync_*` marshalling) is not reached
    //! here — that's framework code we can't drive without spinning up
    //! a webview, and covering it isn't this PR's goal.
    use super::*;
    use crate::sync::backend::{BackendKind, ConflictPolicy};
    use crate::sync::config::CommitIdentity;
    use std::fs;
    use tauri::test::mock_app;
    use tauri::Manager;
    use tempfile::TempDir;

    use crate::sync::DEFAULT_REMOTE_BRANCH;

    struct Workspace {
        tmp: TempDir,
        workspace_path: String,
        remote_path: String,
    }

    impl Workspace {
        fn new() -> Self {
            let tmp = TempDir::new().unwrap();
            let remote = tmp.path().join("remote.git");
            let mut opts = git2::RepositoryInitOptions::new();
            opts.bare(true);
            opts.initial_head(DEFAULT_REMOTE_BRANCH);
            git2::Repository::init_opts(&remote, &opts).unwrap();
            Self {
                workspace_path: tmp.path().join("local").to_string_lossy().into(),
                remote_path: remote.to_string_lossy().into(),
                tmp,
            }
        }

        fn config(&self) -> WorkspaceSyncConfig {
            WorkspaceSyncConfig {
                workspace_path: self.workspace_path.clone(),
                backend: BackendKind::Git,
                remote_url: self.remote_path.clone(),
                remote_branch: DEFAULT_REMOTE_BRANCH.into(),
                conflict_policy: ConflictPolicy::Prompt,
                auto_sync_seconds: None,
                author: Some(CommitIdentity {
                    name: "Test User".into(),
                    email: "test@example.com".into(),
                }),
            }
        }
    }

    #[tokio::test]
    async fn sync_set_config_wrapper_writes_into_managed_state() {
        let app = mock_app();
        app.manage(SyncState::new());
        let ws = Workspace::new();
        sync_set_config(ws.config(), app.state::<SyncState>())
            .await
            .unwrap();
        assert_eq!(
            app.state::<SyncState>()
                .get_config(&ws.workspace_path)
                .unwrap()
                .workspace_path,
            ws.workspace_path
        );
    }

    #[tokio::test]
    async fn sync_get_config_wrapper_returns_none_when_unconfigured() {
        let app = mock_app();
        app.manage(SyncState::new());
        let result = sync_get_config("/missing".into(), app.state::<SyncState>())
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn sync_get_config_wrapper_returns_the_stored_config() {
        let app = mock_app();
        app.manage(SyncState::new());
        let ws = Workspace::new();
        app.state::<SyncState>().set_config(ws.config());
        let result = sync_get_config(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap()
            .expect("config present");
        assert_eq!(result.workspace_path, ws.workspace_path);
    }

    #[tokio::test]
    async fn sync_remove_config_wrapper_drops_the_entry() {
        let app = mock_app();
        app.manage(SyncState::new());
        let ws = Workspace::new();
        app.state::<SyncState>().set_config(ws.config());
        sync_remove_config(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap();
        assert!(app
            .state::<SyncState>()
            .get_config(&ws.workspace_path)
            .is_none());
    }

    #[tokio::test]
    async fn sync_set_token_and_clear_wrappers_round_trip() {
        let app = mock_app();
        app.manage(SyncState::new());
        sync_set_token("/w".into(), "tok".into(), app.state::<SyncState>())
            .await
            .unwrap();
        assert_eq!(
            app.state::<SyncState>().get_token("/w").as_deref(),
            Some("tok")
        );
        sync_clear_token("/w".into(), app.state::<SyncState>())
            .await
            .unwrap();
        assert!(app.state::<SyncState>().get_token("/w").is_none());
    }

    #[tokio::test]
    async fn sync_init_repo_wrapper_creates_a_repo() {
        let ws = Workspace::new();
        sync_init_repo(ws.workspace_path.clone(), None, None)
            .await
            .unwrap();
        assert!(std::path::Path::new(&ws.workspace_path)
            .join(".git")
            .exists());
    }

    #[tokio::test]
    async fn sync_clone_remote_wrapper_populates_a_workspace() {
        let ws = Workspace::new();
        sync_init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();
        fs::write(
            std::path::Path::new(&ws.workspace_path).join("seed.md"),
            "# seed\n",
        )
        .unwrap();
        let app = mock_app();
        app.manage(SyncState::new());
        app.state::<SyncState>().set_config(ws.config());
        sync_run(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap();

        let dest = ws.tmp.path().join("clone-via-wrapper");
        sync_clone_remote(dest.to_string_lossy().into(), ws.remote_path.clone(), None)
            .await
            .unwrap();
        assert!(dest.join("seed.md").exists());
    }

    #[tokio::test]
    async fn sync_status_wrapper_returns_a_status_report() {
        let app = mock_app();
        app.manage(SyncState::new());
        let ws = Workspace::new();
        sync_init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();
        app.state::<SyncState>().set_config(ws.config());
        let status = sync_status(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap();
        assert!(status.clean);
    }

    #[tokio::test]
    async fn sync_run_wrapper_pushes_local_changes() {
        let app = mock_app();
        app.manage(SyncState::new());
        let ws = Workspace::new();
        sync_init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();
        fs::write(
            std::path::Path::new(&ws.workspace_path).join("a.md"),
            "# a\n",
        )
        .unwrap();
        app.state::<SyncState>().set_config(ws.config());
        let result = sync_run(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap();
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);
    }
}
