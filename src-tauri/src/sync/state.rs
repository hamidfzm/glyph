//! Process-lifetime state for the sync subsystem: per-workspace
//! credentials.
//!
//! Sync *config* now lives in the workspace's committed `.glyph/config.json`
//! (see [`crate::workspace`]) — `build_backend` reads it from there. Only
//! tokens remain in memory; the OS-keychain PR will replace that storage
//! while keeping the lookup API identical.

use std::collections::HashMap;
use std::sync::Mutex;

use super::backend::SyncBackend;
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;
use super::git::GitBackend;

#[derive(Default)]
pub struct SyncState {
    /// Per-workspace HTTPS PAT / token. Memory only — wiped on app
    /// restart. The OS-keychain PR will replace this storage while
    /// keeping the lookup API identical.
    tokens: Mutex<HashMap<String, String>>,
}

impl SyncState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_token(&self, workspace_path: String, token: String) {
        self.tokens.lock().unwrap().insert(workspace_path, token);
    }

    pub fn get_token(&self, workspace_path: &str) -> Option<String> {
        self.tokens.lock().unwrap().get(workspace_path).cloned()
    }

    pub fn clear_token(&self, workspace_path: &str) {
        self.tokens.lock().unwrap().remove(workspace_path);
    }

    /// Build a backend matching the workspace's configured `BackendKind`,
    /// pre-loaded with the stored token if any. Reads config from the
    /// workspace's `.glyph/config.json`; returns `NotConfigured` when the workspace
    /// has no sync config, or `Backend` when the config file is unreadable.
    pub fn build_backend(&self, workspace_path: &str) -> Result<Box<dyn SyncBackend>, SyncError> {
        let config = crate::workspace::load_sync_config(workspace_path)
            .map_err(SyncError::Backend)?
            .ok_or(SyncError::NotConfigured)?;
        let token = self.get_token(workspace_path);
        Ok(build_backend(config, token))
    }
}

/// Dispatch on `BackendKind` to produce a concrete backend. Lives here
/// (rather than on a trait) so adding new backends is a one-arm change
/// and the compiler points us at this site when the enum grows.
fn build_backend(config: WorkspaceSyncConfig, token: Option<String>) -> Box<dyn SyncBackend> {
    use super::backend::BackendKind;
    match config.backend {
        BackendKind::Git => {
            let mut backend = GitBackend::new(config);
            if let Some(t) = token {
                backend = backend.with_https_token(t);
            }
            Box::new(backend)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::backend::{BackendKind, ConflictPolicy};
    use tempfile::TempDir;

    fn write_config(workspace: &str) {
        crate::workspace::store_sync_config(&WorkspaceSyncConfig {
            workspace_path: workspace.to_string(),
            backend: BackendKind::Git,
            remote_url: "https://example.com/n.git".to_string(),
            remote_branch: "main".to_string(),
            conflict_policy: ConflictPolicy::Prompt,
            auto_sync_seconds: None,
            author: None,
        })
        .unwrap();
    }

    #[test]
    fn tokens_are_stored_separately_per_workspace() {
        let state = SyncState::new();
        state.set_token("/a".into(), "token-a".into());
        state.set_token("/b".into(), "token-b".into());
        assert_eq!(state.get_token("/a").as_deref(), Some("token-a"));
        assert_eq!(state.get_token("/b").as_deref(), Some("token-b"));
        state.clear_token("/a");
        assert!(state.get_token("/a").is_none());
        assert_eq!(state.get_token("/b").as_deref(), Some("token-b"));
    }

    #[test]
    fn build_backend_errors_when_no_config_is_registered() {
        // `Box<dyn SyncBackend>` isn't Debug, so the usual `unwrap_err`
        // shortcut won't compile here. `.err()` collapses success/failure
        // into a single `Option<SyncError>` we can pattern-match without
        // a dead panic arm. An empty tempdir has no `.glyph/config.json`.
        let tmp = TempDir::new().unwrap();
        let state = SyncState::new();
        let err = state.build_backend(&tmp.path().to_string_lossy()).err();
        assert!(
            matches!(err, Some(SyncError::NotConfigured)),
            "expected NotConfigured, got {err:?}"
        );
    }

    #[test]
    fn build_backend_constructs_a_git_backend_with_the_stored_token() {
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().to_string_lossy().to_string();
        let state = SyncState::new();
        write_config(&workspace);
        state.set_token(workspace.clone(), "tok".into());
        let backend = state.build_backend(&workspace).unwrap();
        assert_eq!(backend.kind(), BackendKind::Git);
        // The token is consumed inside the credential callback; we can
        // only verify it was wired in by exercising a fetch/push, which
        // the `commands::run_sync` tests cover via the local fixture.
    }
}
