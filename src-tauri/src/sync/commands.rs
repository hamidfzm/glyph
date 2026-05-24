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

    // -- Full IPC dispatch test -----------------------------------------
    //
    // The direct-call tests above exercise each wrapper's body, but the
    // proc-macro-emitted `__cmd__sync_*` IPC marshalling lives in code
    // generated at the `#[tauri::command]` attribute line and is only
    // reached when an actual IPC message is delivered. The test below
    // builds a real `mock_builder()` with `generate_handler!`, hands it
    // a webview, and calls `tauri::test::get_ipc_response` for every
    // command — covering the proc-macro lines so codecov's patch
    // metric matches the real test surface.

    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindowBuilder;

    /// Build a fully-wired `App<MockRuntime>` with every sync command
    /// registered and `SyncState` managed, plus a "main" webview ready
    /// for IPC dispatch.
    fn build_ipc_test_app() -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                sync_set_config,
                sync_get_config,
                sync_remove_config,
                sync_set_token,
                sync_clear_token,
                sync_init_repo,
                sync_clone_remote,
                sync_status,
                sync_run,
            ])
            .build(mock_context(noop_assets()))
            .expect("mock app builds");
        app.manage(SyncState::new());
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview builds");
        (app, webview)
    }

    /// Send `cmd` with `args` over IPC and return the deserialized
    /// `Ok` body. Panics on `Err` so the test fails with the libgit2 /
    /// serde message inline.
    fn invoke_ipc<T: serde::de::DeserializeOwned>(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        args: serde_json::Value,
    ) -> T {
        let url = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap();
        let response = get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url,
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|e| panic!("ipc call `{cmd}` failed: {e}"));
        response.deserialize().expect("response deserialises")
    }

    #[test]
    fn ipc_dispatch_covers_every_sync_command() {
        // One big sequential test rather than nine: building the mock
        // app + webview is expensive (compiles the IPC init script), so
        // share the setup and walk through every command's IPC arm.
        let (_app, webview) = build_ipc_test_app();
        let ws = Workspace::new();

        // sync_init_repo
        let _: () = invoke_ipc(
            &webview,
            "sync_init_repo",
            serde_json::json!({
                "workspacePath": ws.workspace_path,
                "defaultBranch": null,
                "remoteUrl": ws.remote_path,
            }),
        );
        assert!(std::path::Path::new(&ws.workspace_path)
            .join(".git")
            .exists());

        // sync_set_config
        let _: () = invoke_ipc(
            &webview,
            "sync_set_config",
            serde_json::json!({ "config": ws.config() }),
        );

        // sync_get_config
        let got: Option<WorkspaceSyncConfig> = invoke_ipc(
            &webview,
            "sync_get_config",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert_eq!(got.unwrap().workspace_path, ws.workspace_path);

        // sync_set_token
        let _: () = invoke_ipc(
            &webview,
            "sync_set_token",
            serde_json::json!({
                "workspacePath": ws.workspace_path,
                "token": "ipc-test-tok",
            }),
        );

        // sync_status — clean working tree, no remote movement.
        let status: crate::sync::backend::StatusReport = invoke_ipc(
            &webview,
            "sync_status",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert!(status.clean);

        // Write a file, then sync_run — commits + pushes.
        fs::write(
            std::path::Path::new(&ws.workspace_path).join("note.md"),
            "# hi\n",
        )
        .unwrap();
        let result: crate::sync::backend::SyncResult = invoke_ipc(
            &webview,
            "sync_run",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);

        // sync_clone_remote into a fresh path.
        let dest = ws.tmp.path().join("ipc-clone");
        let _: () = invoke_ipc(
            &webview,
            "sync_clone_remote",
            serde_json::json!({
                "workspacePath": dest.to_string_lossy(),
                "remoteUrl": ws.remote_path,
                "token": null,
            }),
        );
        assert!(dest.join("note.md").exists());

        // sync_clear_token
        let _: () = invoke_ipc(
            &webview,
            "sync_clear_token",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );

        // sync_remove_config — leaves the workspace unconfigured.
        let _: () = invoke_ipc(
            &webview,
            "sync_remove_config",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        let after: Option<WorkspaceSyncConfig> = invoke_ipc(
            &webview,
            "sync_get_config",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert!(after.is_none());
    }
}
