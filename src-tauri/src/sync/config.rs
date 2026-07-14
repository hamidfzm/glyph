//! Per-workspace sync configuration.
//!
//! This is the in-memory / IPC shape. It is persisted inside the workspace as
//! `.glyph/config.json` (see [`crate::workspace::config`]) — committed, so it
//! travels with a `git clone` — minus the `workspace_path` field, which is
//! implied by the file's location and injected back on read.
//!
//! Credentials (PAT / SSH passphrase / etc.) are *not* in this struct —
//! they live in the OS keychain via [`crate::secrets`] (see
//! [`crate::sync::state`]). This struct only carries the bits we'd happily
//! write to disk in plaintext.

use serde::{Deserialize, Serialize};

use super::backend::{BackendKind, ConflictPolicy};
use super::DEFAULT_REMOTE_BRANCH;

/// What we keep on disk for a single workspace's sync setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncConfig {
    /// Workspace root, absolute. Acts as the lookup key in the store.
    pub workspace_path: String,
    /// Which backend variant is configured.
    pub backend: BackendKind,
    /// Remote URL — `https://github.com/user/notes.git`, etc.
    pub remote_url: String,
    /// Branch we follow on the remote. Defaults to `main`.
    pub remote_branch: String,
    /// What to do when local and remote disagree on the same file.
    pub conflict_policy: ConflictPolicy,
    /// Author identity used for commits Glyph creates on the user's
    /// behalf. Optional — falls back to libgit2's global config when
    /// `None`.
    pub author: Option<CommitIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitIdentity {
    pub name: String,
    pub email: String,
}

/// Best-effort hint of an author identity sourced from git's config.
///
/// Both fields are independently optional: `user.name` and `user.email`
/// can be set in isolation, and a brand-new install has neither. The
/// frontend uses these strings as placeholders on the author fields in
/// the Cloud Sync setup form so users see what would be used if they
/// leave the fields blank.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommitAuthorHint {
    pub name: Option<String>,
    pub email: Option<String>,
}

impl WorkspaceSyncConfig {
    /// Default config for a brand new Git-backed workspace. Caller still
    /// has to fill in `remote_url`.
    pub fn new_git(workspace_path: impl Into<String>) -> Self {
        Self {
            workspace_path: workspace_path.into(),
            backend: BackendKind::Git,
            remote_url: String::new(),
            remote_branch: DEFAULT_REMOTE_BRANCH.to_string(),
            conflict_policy: ConflictPolicy::default(),
            author: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_git_defaults_to_main_branch_and_prompt_conflicts() {
        let cfg = WorkspaceSyncConfig::new_git("/workspace/notes");
        assert_eq!(cfg.workspace_path, "/workspace/notes");
        assert_eq!(cfg.backend, BackendKind::Git);
        assert!(cfg.remote_url.is_empty());
        assert_eq!(cfg.remote_branch, DEFAULT_REMOTE_BRANCH);
        assert_eq!(cfg.conflict_policy, ConflictPolicy::Prompt);
        assert!(cfg.author.is_none());
    }

    #[test]
    fn round_trips_through_serde_camel_case() {
        let cfg = WorkspaceSyncConfig {
            workspace_path: "/w".to_string(),
            backend: BackendKind::Git,
            remote_url: "https://example.com/notes.git".to_string(),
            remote_branch: "trunk".to_string(),
            conflict_policy: ConflictPolicy::PreferRemote,
            author: Some(CommitIdentity {
                name: "Hamid".into(),
                email: "h@example.com".into(),
            }),
        };
        let v = serde_json::to_value(&cfg).unwrap();
        assert_eq!(v["workspacePath"], "/w");
        assert_eq!(v["remoteUrl"], "https://example.com/notes.git");
        assert_eq!(v["remoteBranch"], "trunk");
        assert_eq!(v["conflictPolicy"], "prefer-remote");
        assert_eq!(v["author"]["name"], "Hamid");

        let round: WorkspaceSyncConfig = serde_json::from_value(v).unwrap();
        assert_eq!(round, cfg);
    }

    #[test]
    fn deserialises_minimal_payload_omitting_optionals() {
        let json = serde_json::json!({
            "workspacePath": "/w",
            "backend": "git",
            "remoteUrl": "https://example.com/n.git",
            "remoteBranch": "main",
            "conflictPolicy": "prompt",
            "author": null,
        });
        let cfg: WorkspaceSyncConfig = serde_json::from_value(json).unwrap();
        assert!(cfg.author.is_none());
    }
}
