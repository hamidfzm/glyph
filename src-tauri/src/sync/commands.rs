//! Tauri command surface for cloud sync.
//!
//! Every function in this file is a thin `#[tauri::command]` wrapper
//! around an async helper in [`super::ops`]. The proc-macro emits IPC
//! marshalling code that isn't reachable from a direct function call,
//! so this file is excluded from codecov coverage; the real logic lives
//! in `ops.rs` and is fully tested there.

use tauri::State;

use super::backend::{StatusReport, SyncResult};
use super::config::{CommitAuthorHint, WorkspaceSyncConfig};
use super::error::SyncError;
use super::ops;
use super::state::SyncState;

#[tauri::command]
pub async fn sync_set_config(config: WorkspaceSyncConfig) -> Result<(), SyncError> {
    ops::set_config(config)
}

#[tauri::command]
pub async fn sync_get_config(
    workspace_path: String,
) -> Result<Option<WorkspaceSyncConfig>, SyncError> {
    ops::get_config(&workspace_path)
}

#[tauri::command]
pub async fn sync_remove_config(workspace_path: String) -> Result<(), SyncError> {
    ops::remove_config(&workspace_path)
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

/// Write `[remote "origin"] url = <remote_url>` into the workspace's
/// `.git/config`. The modal's Save flow calls this when the repo
/// already exists so libgit2's fetch/push uses Glyph's configured URL
/// instead of whatever stale origin the existing repo happens to carry.
#[tauri::command]
pub async fn sync_set_origin(workspace_path: String, remote_url: String) -> Result<(), SyncError> {
    ops::set_origin(workspace_path, remote_url).await
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
    message: Option<String>,
    state: State<'_, SyncState>,
) -> Result<SyncResult, SyncError> {
    ops::run_sync(&state, &workspace_path, message).await
}

#[tauri::command]
pub async fn sync_default_author(workspace_path: String) -> Result<CommitAuthorHint, SyncError> {
    Ok(ops::default_author(&workspace_path))
}

#[tauri::command]
pub async fn sync_repo_present(workspace_path: String) -> Result<bool, SyncError> {
    Ok(ops::repo_present(&workspace_path))
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
    async fn sync_set_config_wrapper_writes_the_workspace_config() {
        let ws = Workspace::new();
        sync_set_config(ws.config()).await.unwrap();
        // Reads back through the same command surface from `.glyph/config.json`.
        let got = sync_get_config(ws.workspace_path.clone())
            .await
            .unwrap()
            .expect("config present");
        assert_eq!(got.workspace_path, ws.workspace_path);
    }

    #[tokio::test]
    async fn sync_get_config_wrapper_returns_none_when_unconfigured() {
        let tmp = TempDir::new().unwrap();
        let result = sync_get_config(tmp.path().to_string_lossy().into())
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn sync_get_config_wrapper_returns_the_stored_config() {
        let ws = Workspace::new();
        crate::workspace::store_sync_config(&ws.config()).unwrap();
        let result = sync_get_config(ws.workspace_path.clone())
            .await
            .unwrap()
            .expect("config present");
        assert_eq!(result.workspace_path, ws.workspace_path);
    }

    #[tokio::test]
    async fn sync_remove_config_wrapper_drops_the_entry() {
        let ws = Workspace::new();
        crate::workspace::store_sync_config(&ws.config()).unwrap();
        sync_remove_config(ws.workspace_path.clone()).await.unwrap();
        assert!(sync_get_config(ws.workspace_path.clone())
            .await
            .unwrap()
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
        crate::workspace::store_sync_config(&ws.config()).unwrap();
        sync_run(ws.workspace_path.clone(), None, app.state::<SyncState>())
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
        crate::workspace::store_sync_config(&ws.config()).unwrap();
        let status = sync_status(ws.workspace_path.clone(), app.state::<SyncState>())
            .await
            .unwrap();
        // Storing the config wrote `.glyph/config.json` into the working
        // tree, so a freshly-configured workspace reports as dirty until the
        // first sync commits it.
        assert!(!status.clean);
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
        crate::workspace::store_sync_config(&ws.config()).unwrap();
        let result = sync_run(
            ws.workspace_path.clone(),
            Some("test commit".into()),
            app.state::<SyncState>(),
        )
        .await
        .unwrap();
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);
    }

    #[tokio::test]
    async fn sync_default_author_wrapper_returns_a_hint() {
        // We only assert the call shape (returns an Ok payload). The
        // actual fields depend on whether the test host has any git
        // config at all, which we can't pin from a unit test.
        let ws = Workspace::new();
        let _hint = sync_default_author(ws.workspace_path).await.unwrap();
    }

    #[tokio::test]
    async fn sync_default_author_wrapper_returns_config_values() {
        // With per-workspace `[user]` set we can pin the returned hint
        // regardless of what the host's global git config carries.
        let tmp = tempfile::TempDir::new().unwrap();
        let workspace = tmp.path().to_string_lossy().to_string();
        git2::Repository::init(tmp.path()).unwrap();
        let cfg_path = tmp.path().join(".git/config");
        let mut cfg = git2::Config::open(&cfg_path).unwrap();
        cfg.set_str("user.name", "Cmd Author").unwrap();
        cfg.set_str("user.email", "cmd@example.com").unwrap();

        let hint = sync_default_author(workspace).await.unwrap();
        assert_eq!(hint.name.as_deref(), Some("Cmd Author"));
        assert_eq!(hint.email.as_deref(), Some("cmd@example.com"));
    }

    #[tokio::test]
    async fn sync_set_origin_wrapper_writes_remote_url() {
        let ws = Workspace::new();
        // Init the workspace via the same wrapper the frontend would use.
        sync_init_repo(ws.workspace_path.clone(), None, None)
            .await
            .unwrap();
        sync_set_origin(
            ws.workspace_path.clone(),
            "https://example.com/x.git".into(),
        )
        .await
        .unwrap();
        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://example.com/x.git"));
    }

    #[tokio::test]
    async fn sync_repo_present_wrapper_returns_true_after_init() {
        let ws = Workspace::new();
        sync_init_repo(ws.workspace_path.clone(), None, None)
            .await
            .unwrap();
        assert!(sync_repo_present(ws.workspace_path).await.unwrap());
    }

    #[tokio::test]
    async fn sync_repo_present_wrapper_returns_false_for_empty_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(!sync_repo_present(tmp.path().to_string_lossy().into())
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn sync_repo_present_wrapper_reports_true_after_init() {
        let ws = Workspace::new();
        assert!(!sync_repo_present(ws.workspace_path.clone()).await.unwrap());
        sync_init_repo(ws.workspace_path.clone(), None, None)
            .await
            .unwrap();
        assert!(sync_repo_present(ws.workspace_path).await.unwrap());
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
                sync_set_origin,
                sync_status,
                sync_run,
                sync_default_author,
                sync_repo_present,
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

        // sync_status — the config we just set wrote `.glyph/config.json`
        // into the working tree, so the workspace reads as dirty until the
        // first sync commits it.
        let status: crate::sync::backend::StatusReport = invoke_ipc(
            &webview,
            "sync_status",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert!(!status.clean);

        // Write a file, then sync_run — commits + pushes.
        fs::write(
            std::path::Path::new(&ws.workspace_path).join("note.md"),
            "# hi\n",
        )
        .unwrap();
        let result: crate::sync::backend::SyncResult = invoke_ipc(
            &webview,
            "sync_run",
            serde_json::json!({
                "workspacePath": ws.workspace_path,
                "message": "ipc commit",
            }),
        );
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);

        // sync_default_author and sync_repo_present round-trip through IPC.
        let _: crate::sync::config::CommitAuthorHint = invoke_ipc(
            &webview,
            "sync_default_author",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        let present: bool = invoke_ipc(
            &webview,
            "sync_repo_present",
            serde_json::json!({ "workspacePath": ws.workspace_path }),
        );
        assert!(present);

        // sync_repo_present against an empty dir round-trips through IPC
        // and returns the false arm.
        let empty_dir = ws.tmp.path().join("nope");
        std::fs::create_dir_all(&empty_dir).unwrap();
        let absent: bool = invoke_ipc(
            &webview,
            "sync_repo_present",
            serde_json::json!({ "workspacePath": empty_dir.to_string_lossy() }),
        );
        assert!(!absent);

        // sync_set_origin updates `.git/config` over IPC.
        let _: () = invoke_ipc(
            &webview,
            "sync_set_origin",
            serde_json::json!({
                "workspacePath": ws.workspace_path,
                "remoteUrl": "https://example.com/ipc-set.git",
            }),
        );
        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://example.com/ipc-set.git"));

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
