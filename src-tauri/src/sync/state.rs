//! Process-lifetime state for the sync subsystem: per-workspace configs
//! and per-workspace credentials.
//!
//! Configs and tokens are held in memory only in this PR. The next PR in
//! the series moves persistent config into `tauri-plugin-store`, and the
//! one after that routes credentials through the OS keychain. The shape
//! of [`SyncState`] doesn't change as those land — only the read/write
//! implementations behind it.

use std::collections::HashMap;
use std::sync::Mutex;

use super::backend::SyncBackend;
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;
use super::git::GitBackend;

#[derive(Default)]
pub struct SyncState {
    configs: Mutex<HashMap<String, WorkspaceSyncConfig>>,
    /// Per-workspace HTTPS PAT / token. Memory only — wiped on app
    /// restart. The OS-keychain PR will replace this storage while
    /// keeping the lookup API identical.
    tokens: Mutex<HashMap<String, String>>,
}

impl SyncState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_config(&self, config: WorkspaceSyncConfig) {
        self.configs
            .lock()
            .unwrap()
            .insert(config.workspace_path.clone(), config);
    }

    pub fn get_config(&self, workspace_path: &str) -> Option<WorkspaceSyncConfig> {
        self.configs.lock().unwrap().get(workspace_path).cloned()
    }

    pub fn remove_config(&self, workspace_path: &str) {
        self.configs.lock().unwrap().remove(workspace_path);
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
    /// pre-loaded with the stored token if any. Returns `NotConfigured`
    /// when no config is registered for the workspace.
    pub fn build_backend(&self, workspace_path: &str) -> Result<Box<dyn SyncBackend>, SyncError> {
        let config = self
            .get_config(workspace_path)
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

    fn make_config(workspace: &str) -> WorkspaceSyncConfig {
        WorkspaceSyncConfig {
            workspace_path: workspace.to_string(),
            backend: BackendKind::Git,
            remote_url: "https://example.com/n.git".to_string(),
            remote_branch: "main".to_string(),
            conflict_policy: ConflictPolicy::Prompt,
            auto_sync_seconds: None,
            author: None,
        }
    }

    #[test]
    fn empty_state_has_no_config() {
        let state = SyncState::new();
        assert!(state.get_config("/anywhere").is_none());
    }

    #[test]
    fn set_then_get_config_round_trips() {
        let state = SyncState::new();
        state.set_config(make_config("/workspace/notes"));
        let cfg = state.get_config("/workspace/notes").unwrap();
        assert_eq!(cfg.workspace_path, "/workspace/notes");
        assert_eq!(cfg.backend, BackendKind::Git);
    }

    #[test]
    fn set_config_replaces_an_existing_entry_for_the_same_workspace() {
        let state = SyncState::new();
        state.set_config(make_config("/w"));
        let mut updated = make_config("/w");
        updated.remote_url = "https://other.example/n.git".into();
        state.set_config(updated);
        let cfg = state.get_config("/w").unwrap();
        assert_eq!(cfg.remote_url, "https://other.example/n.git");
    }

    #[test]
    fn remove_config_drops_the_entry() {
        let state = SyncState::new();
        state.set_config(make_config("/w"));
        state.remove_config("/w");
        assert!(state.get_config("/w").is_none());
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
        // a dead panic arm.
        let state = SyncState::new();
        let err = state.build_backend("/missing").err();
        assert!(
            matches!(err, Some(SyncError::NotConfigured)),
            "expected NotConfigured, got {err:?}"
        );
    }

    #[test]
    fn build_backend_constructs_a_git_backend_with_the_stored_token() {
        let state = SyncState::new();
        state.set_config(make_config("/w"));
        state.set_token("/w".into(), "tok".into());
        let backend = state.build_backend("/w").unwrap();
        assert_eq!(backend.kind(), BackendKind::Git);
        // The token is consumed inside the credential callback; we can
        // only verify it was wired in by exercising a fetch/push, which
        // the `commands::run_sync` tests cover via the local fixture.
    }
}
