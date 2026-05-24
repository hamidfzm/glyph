//! Pure async operations the Tauri commands forward to.
//!
//! Each `#[tauri::command]` in [`super::commands`] is a one-liner that
//! calls a helper from this module. Splitting them out lets us drive the
//! full sync surface from `#[tokio::test]` against a plain `&SyncState`
//! without needing a Tauri runtime, and it lets `commands.rs` stay a
//! thin IPC adapter that codecov ignores (the `#[tauri::command]`
//! macro emits IPC marshalling code that isn't reachable from direct
//! function calls, so coverage there is misleading).

use std::path::PathBuf;

use super::backend::{StatusReport, SyncResult};
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;
use super::git;
use super::state::SyncState;
use super::DEFAULT_REMOTE_BRANCH;

/// Persist (or replace) the sync config for the workspace it names.
pub fn set_config(state: &SyncState, config: WorkspaceSyncConfig) {
    state.set_config(config);
}

/// Look up the stored config for a workspace. `None` is a clean "not
/// configured yet" signal, distinct from an error.
pub fn get_config(state: &SyncState, workspace_path: &str) -> Option<WorkspaceSyncConfig> {
    state.get_config(workspace_path)
}

/// Forget a workspace's config (e.g. user disabled sync for it).
pub fn remove_config(state: &SyncState, workspace_path: &str) {
    state.remove_config(workspace_path);
}

/// Stash a credential token in memory for `workspace_path`. The OS-keychain
/// PR replaces this implementation; the call signature stays the same.
pub fn set_token(state: &SyncState, workspace_path: String, token: String) {
    state.set_token(workspace_path, token);
}

/// Drop the in-memory token for a workspace.
pub fn clear_token(state: &SyncState, workspace_path: &str) {
    state.clear_token(workspace_path);
}

/// Initialise a fresh repository at `workspace_path` with `default_branch`
/// as HEAD. Sets `origin` to `remote_url` when one is supplied so the
/// follow-up `run_sync` call can push to it.
pub async fn init_repo(
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
pub async fn clone_remote(
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
pub async fn run_status(
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
pub async fn run_sync(state: &SyncState, workspace_path: &str) -> Result<SyncResult, SyncError> {
    let backend = state.build_backend(workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || backend.sync())
        .await
        .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::backend::{BackendKind, ConflictPolicy};
    use crate::sync::config::CommitIdentity;
    use std::fs;
    use tempfile::TempDir;

    /// Mirror of `sync::git::tests::Fixture` so the ops tests have a
    /// real bare-repo backend to drive without depending on internals.
    pub(super) struct Workspace {
        pub tmp: TempDir,
        pub workspace_path: String,
        pub remote_path: String,
    }

    impl Workspace {
        pub fn new() -> Self {
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

        pub fn config(&self) -> WorkspaceSyncConfig {
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
    async fn init_repo_creates_a_repo_with_origin_set() {
        let ws = Workspace::new();
        init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();

        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some(ws.remote_path.as_str()));
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(
            head.symbolic_target(),
            Some(format!("refs/heads/{DEFAULT_REMOTE_BRANCH}").as_str())
        );
    }

    #[tokio::test]
    async fn init_repo_respects_an_explicit_default_branch() {
        let ws = Workspace::new();
        init_repo(ws.workspace_path.clone(), Some("trunk".into()), None)
            .await
            .unwrap();
        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target(), Some("refs/heads/trunk"));
    }

    #[tokio::test]
    async fn run_status_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_status(&state, &ws.workspace_path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_sync_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_sync(&state, &ws.workspace_path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_status_errors_when_config_set_but_repo_is_missing() {
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
        set_config(&state, config);
        let err = run_status(&state, &path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn full_init_then_sync_round_trip() {
        let ws = Workspace::new();
        let state = SyncState::new();

        init_repo(
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

        set_config(&state, ws.config());

        let result = run_sync(&state, &ws.workspace_path).await.unwrap();
        assert_eq!(result.kind, BackendKind::Git);
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);
        assert!(result.conflicts.is_empty());

        let status = run_status(&state, &ws.workspace_path).await.unwrap();
        assert!(status.clean);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[tokio::test]
    async fn clone_remote_populates_a_fresh_workspace_from_the_remote() {
        let ws = Workspace::new();
        init_repo(
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
        set_config(&state, ws.config());
        run_sync(&state, &ws.workspace_path).await.unwrap();

        let dest = ws.tmp.path().join("clone-into-me");
        clone_remote(dest.to_string_lossy().into(), ws.remote_path.clone(), None)
            .await
            .unwrap();
        assert!(dest.join("seed.md").exists());
    }

    #[tokio::test]
    async fn config_set_then_get_round_trips_through_the_command_helpers() {
        let ws = Workspace::new();
        let state = SyncState::new();
        assert!(get_config(&state, &ws.workspace_path).is_none());
        set_config(&state, ws.config());
        let cfg = get_config(&state, &ws.workspace_path).unwrap();
        assert_eq!(cfg.workspace_path, ws.workspace_path);
        assert_eq!(cfg.backend, BackendKind::Git);
        remove_config(&state, &ws.workspace_path);
        assert!(get_config(&state, &ws.workspace_path).is_none());
    }

    #[tokio::test]
    async fn token_set_clear_round_trip() {
        let state = SyncState::new();
        set_token(&state, "/ws".into(), "tok".into());
        assert_eq!(state.get_token("/ws").as_deref(), Some("tok"));
        clear_token(&state, "/ws");
        assert!(state.get_token("/ws").is_none());
    }
}
