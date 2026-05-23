//! Tauri command surface for cloud sync.
//!
//! Layout choice: every `#[tauri::command]` is a thin wrapper around a
//! pure async helper (`run_sync_inner`, `run_status_inner`, etc.). The
//! helpers take a plain `&SyncState` reference instead of Tauri's
//! `State<'_, T>` wrapper so tests can drive them directly without
//! standing up a full Tauri runtime. The wrappers only do
//! `helper(&state, …).await`.
//!
//! All blocking work (libgit2 calls) is dispatched through
//! `tauri::async_runtime::spawn_blocking` so the Tauri async runtime thread stays
//! free.

use std::path::PathBuf;

use tauri::State;

use super::backend::{StatusReport, SyncResult};
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;
use super::git;
use super::state::SyncState;
use super::DEFAULT_REMOTE_BRANCH;

// -- Pure helpers (testable without Tauri) -----------------------------------

/// Persist (or replace) the sync config for the workspace it names.
pub fn set_config_inner(state: &SyncState, config: WorkspaceSyncConfig) {
    state.set_config(config);
}

/// Look up the stored config for a workspace. `None` is a clean "not
/// configured yet" signal, distinct from an error.
pub fn get_config_inner(state: &SyncState, workspace_path: &str) -> Option<WorkspaceSyncConfig> {
    state.get_config(workspace_path)
}

/// Forget a workspace's config (e.g. user disabled sync for it).
pub fn remove_config_inner(state: &SyncState, workspace_path: &str) {
    state.remove_config(workspace_path);
}

/// Stash a credential token in memory for `workspace_path`. The OS-keychain
/// PR replaces this implementation; the call signature stays the same.
pub fn set_token_inner(state: &SyncState, workspace_path: String, token: String) {
    state.set_token(workspace_path, token);
}

pub fn clear_token_inner(state: &SyncState, workspace_path: &str) {
    state.clear_token(workspace_path);
}

/// Initialise a fresh repository at `workspace_path` with `default_branch`
/// as HEAD. Sets `origin` to `remote_url` when one is supplied so the
/// follow-up `sync_run` call can push to it.
pub async fn init_repo_inner(
    workspace_path: String,
    default_branch: Option<String>,
    remote_url: Option<String>,
) -> Result<(), SyncError> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = default_branch.unwrap_or_else(|| DEFAULT_REMOTE_BRANCH.to_string());
        let path = PathBuf::from(&workspace_path);
        git::init_repo(&path, &branch)?;
        if let Some(url) = remote_url {
            git::set_origin(&path, &url)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Clone `remote_url` into `workspace_path`. Destination must not exist
/// yet (libgit2 rule). When `token` is provided it's used as HTTPS
/// basic-auth.
pub async fn clone_remote_inner(
    workspace_path: String,
    remote_url: String,
    token: Option<String>,
) -> Result<(), SyncError> {
    tauri::async_runtime::spawn_blocking(move || {
        git::clone_repo(
            &remote_url,
            &PathBuf::from(&workspace_path),
            token.as_deref(),
        )
        .map(|_| ())
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Build the configured backend for `workspace_path` and ask it for its
/// status. Errors with `NotConfigured` when no config has been stored
/// yet — the frontend interprets that as "show the setup CTA".
pub async fn run_status_inner(
    state: &SyncState,
    workspace_path: &str,
) -> Result<StatusReport, SyncError> {
    let backend = state.build_backend(workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || backend.status())
        .await
        .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Build the configured backend and run a full sync (stage → commit →
/// fetch → merge → push). Conflicts come back via `SyncResult.conflicts`,
/// not as an error — the frontend opens the conflict UI for those.
pub async fn run_sync_inner(
    state: &SyncState,
    workspace_path: &str,
) -> Result<SyncResult, SyncError> {
    let backend = state.build_backend(workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || backend.sync())
        .await
        .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

// -- Tauri command wrappers --------------------------------------------------

#[tauri::command]
pub async fn sync_set_config(
    config: WorkspaceSyncConfig,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    set_config_inner(&state, config);
    Ok(())
}

#[tauri::command]
pub async fn sync_get_config(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<Option<WorkspaceSyncConfig>, SyncError> {
    Ok(get_config_inner(&state, &workspace_path))
}

#[tauri::command]
pub async fn sync_remove_config(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    remove_config_inner(&state, &workspace_path);
    Ok(())
}

#[tauri::command]
pub async fn sync_set_token(
    workspace_path: String,
    token: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    set_token_inner(&state, workspace_path, token);
    Ok(())
}

#[tauri::command]
pub async fn sync_clear_token(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<(), SyncError> {
    clear_token_inner(&state, &workspace_path);
    Ok(())
}

#[tauri::command]
pub async fn sync_init_repo(
    workspace_path: String,
    default_branch: Option<String>,
    remote_url: Option<String>,
) -> Result<(), SyncError> {
    init_repo_inner(workspace_path, default_branch, remote_url).await
}

#[tauri::command]
pub async fn sync_clone_remote(
    workspace_path: String,
    remote_url: String,
    token: Option<String>,
) -> Result<(), SyncError> {
    clone_remote_inner(workspace_path, remote_url, token).await
}

#[tauri::command]
pub async fn sync_status(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<StatusReport, SyncError> {
    run_status_inner(&state, &workspace_path).await
}

#[tauri::command]
pub async fn sync_run(
    workspace_path: String,
    state: State<'_, SyncState>,
) -> Result<SyncResult, SyncError> {
    run_sync_inner(&state, &workspace_path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::backend::{BackendKind, ConflictPolicy};
    use crate::sync::config::CommitIdentity;
    use std::fs;
    use tempfile::TempDir;

    /// Reusable harness mirroring git::tests::Fixture so the command
    /// tests have a real bare-repo backend to drive.
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
                remote_branch: DEFAULT_REMOTE_BRANCH.to_string(),
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
    async fn init_repo_inner_creates_a_repo_with_origin_set() {
        let ws = Workspace::new();
        init_repo_inner(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();

        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some(ws.remote_path.as_str()));
        // Default branch defaults to DEFAULT_REMOTE_BRANCH when caller
        // passes None.
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(
            head.symbolic_target(),
            Some(format!("refs/heads/{DEFAULT_REMOTE_BRANCH}").as_str())
        );
    }

    #[tokio::test]
    async fn init_repo_inner_respects_an_explicit_default_branch() {
        let ws = Workspace::new();
        init_repo_inner(ws.workspace_path.clone(), Some("trunk".into()), None)
            .await
            .unwrap();
        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target(), Some("refs/heads/trunk"));
    }

    #[tokio::test]
    async fn run_status_inner_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_status_inner(&state, &ws.workspace_path)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_sync_inner_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_sync_inner(&state, &ws.workspace_path)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_status_inner_errors_when_config_set_but_repo_is_missing() {
        // Config says "look at this path" but the path isn't a git repo.
        // Backend should bubble up NotConfigured (the git open path).
        let tmp = TempDir::new().unwrap();
        let state = SyncState::new();
        let config = WorkspaceSyncConfig {
            workspace_path: tmp.path().to_string_lossy().into(),
            backend: BackendKind::Git,
            remote_url: String::new(),
            remote_branch: DEFAULT_REMOTE_BRANCH.into(),
            conflict_policy: ConflictPolicy::Prompt,
            auto_sync_seconds: None,
            author: None,
        };
        let path = config.workspace_path.clone();
        set_config_inner(&state, config);
        let err = run_status_inner(&state, &path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn full_init_then_sync_round_trip() {
        // 1. init_repo creates the local repo + origin
        // 2. write a file
        // 3. sync_run commits + pushes
        // 4. status_inner reports a clean working tree
        let ws = Workspace::new();
        let state = SyncState::new();

        init_repo_inner(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();

        fs::write(
            std::path::Path::new(&ws.workspace_path).join("notes.md"),
            "# hello\n",
        )
        .unwrap();

        set_config_inner(&state, ws.config());

        let result = run_sync_inner(&state, &ws.workspace_path).await.unwrap();
        assert_eq!(result.kind, BackendKind::Git);
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);
        assert!(result.conflicts.is_empty());

        let status = run_status_inner(&state, &ws.workspace_path).await.unwrap();
        assert!(status.clean);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[tokio::test]
    async fn clone_remote_inner_populates_a_fresh_workspace_from_the_remote() {
        // Seed the remote by syncing from another workspace, then clone
        // into a new path and confirm the file landed.
        let ws = Workspace::new();
        init_repo_inner(
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
        let state = SyncState::new();
        set_config_inner(&state, ws.config());
        run_sync_inner(&state, &ws.workspace_path).await.unwrap();

        let dest = ws.tmp.path().join("clone-into-me");
        clone_remote_inner(dest.to_string_lossy().into(), ws.remote_path.clone(), None)
            .await
            .unwrap();
        assert!(dest.join("seed.md").exists());
    }

    #[tokio::test]
    async fn config_set_then_get_round_trips_through_the_command_helpers() {
        let ws = Workspace::new();
        let state = SyncState::new();
        assert!(get_config_inner(&state, &ws.workspace_path).is_none());
        set_config_inner(&state, ws.config());
        let cfg = get_config_inner(&state, &ws.workspace_path).unwrap();
        assert_eq!(cfg.workspace_path, ws.workspace_path);
        assert_eq!(cfg.backend, BackendKind::Git);
        remove_config_inner(&state, &ws.workspace_path);
        assert!(get_config_inner(&state, &ws.workspace_path).is_none());
    }

    #[tokio::test]
    async fn token_set_clear_round_trip() {
        let state = SyncState::new();
        set_token_inner(&state, "/ws".into(), "tok".into());
        assert_eq!(state.get_token("/ws").as_deref(), Some("tok"));
        clear_token_inner(&state, "/ws");
        assert!(state.get_token("/ws").is_none());
    }
}
