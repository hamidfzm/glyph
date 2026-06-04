//! Pluggable sync backend interface.
//!
//! Every sync backend implements [`SyncBackend`] — Git today, WebDAV /
//! S3 / Nextcloud / enterprise plans tomorrow. The trait deliberately
//! mirrors a "batch sync" model (status + sync = pull/push) because
//! that's what Approach B in issue #113 asks for and what every
//! filesystem-backed sync target supports.
//!
//! ### Future: realtime collaboration backends
//!
//! Realtime collab (Yjs over WebSocket) does not fit the batch model —
//! it needs continuous publish/subscribe semantics. When that backend
//! lands it will get its own trait (e.g. `RealtimeSyncBackend`) instead
//! of trying to stretch [`SyncBackend`] to cover both modes. UI code
//! that wants to talk to "whatever's configured" will branch on
//! [`BackendKind`].

use serde::{Deserialize, Serialize};

use super::error::SyncError;

/// Which backend implementation a workspace is configured to use.
///
/// New variants get added here as backends ship — the rest of the code
/// pattern-matches against this so the compiler tells us every
/// dispatch site that needs updating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendKind {
    /// `git2`-backed local repository plus `origin` remote.
    Git,
    // Reserved for future PRs — listed here so the enum stays the single
    // source of truth for "what can a workspace sync to":
    // Webdav,
    // S3,
    // Realtime,
}

/// What to do when local and remote disagree on the same file. v1 only
/// applies to text files; binary attachments always prompt the user.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictPolicy {
    /// Stop and surface every conflict in the UI for the user to resolve
    /// manually. Default; matches what Obsidian Sync does.
    #[default]
    Prompt,
    /// Take the remote version, drop local edits. For "I just want the
    /// other device's state" cases.
    PreferRemote,
    /// Take the local version, push over the remote. Mirror of
    /// PreferRemote for the other direction.
    PreferLocal,
}

/// Inspect-only snapshot of "where is this workspace at relative to
/// its remote?". Computed without writing anything so it can refresh
/// cheaply (status bar polling, manual refresh button).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub kind: BackendKind,
    /// `true` if the working tree has no uncommitted changes.
    pub clean: bool,
    /// Commits that exist locally but have not been pushed to the remote.
    pub ahead: u32,
    /// Commits that exist on the remote but have not been pulled.
    pub behind: u32,
    /// File paths (relative to the workspace root) that are currently in
    /// a conflicting state from a previous sync attempt and still need
    /// the user's attention.
    pub conflicts: Vec<String>,
    /// Unix-second timestamp of the last successful sync, if any. The
    /// frontend renders this however it likes ("2 minutes ago", etc.).
    pub last_sync_unix: Option<i64>,
}

/// Outcome of a single [`SyncBackend::sync`] call. Frontend renders a
/// short summary ("3 changes pulled, 1 committed locally") and stashes
/// the timestamp so the next status check can show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub kind: BackendKind,
    /// New commits pulled from the remote.
    pub pulled_count: u32,
    /// Local commits created for previously-uncommitted changes.
    pub committed_count: u32,
    /// Commits pushed to the remote.
    pub pushed_count: u32,
    /// Files that came back conflicting after the merge attempt; sync
    /// returns successfully here so the UI can surface them, then the
    /// next call will refuse to sync until they're resolved.
    pub conflicts: Vec<String>,
    /// Unix-second timestamp recorded at the end of the call.
    pub completed_unix: i64,
}

/// What every batch sync backend must offer.
///
/// Implementations are **blocking** by design (libgit2 is sync, WebDAV
/// PUT/GET is sync, etc.); Tauri command handlers wrap calls in
/// `tokio::task::spawn_blocking` so the runtime thread stays free.
/// Realtime backends will get their own async trait.
pub trait SyncBackend: Send + Sync {
    fn kind(&self) -> BackendKind;

    /// Inspect-only — never writes to disk or the network.
    fn status(&self) -> Result<StatusReport, SyncError>;

    /// Stage local changes, commit, fetch remote, merge, push. Returns a
    /// summary the frontend can show; surfaces conflicts via the
    /// `conflicts` field so the UI can open the resolution panel.
    ///
    /// `commit_message` lets the caller override the commit subject used
    /// for the auto-commit step. `None` (or an all-whitespace string)
    /// asks the backend to generate one from the staged diff, matching
    /// GitHub's web editor conventions.
    fn sync(&self, commit_message: Option<&str>) -> Result<SyncResult, SyncError>;

    /// Commit the workspace's local config directory into history when it
    /// isn't tracked yet, so enabling sync persists the config immediately
    /// (and it travels with clones) instead of waiting for the first
    /// content sync. Returns `true` when a commit was created. Backends
    /// with no notion of committed config keep the default no-op.
    fn commit_config(&self) -> Result<bool, SyncError> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_config_defaults_to_a_noop() {
        // A backend that doesn't override commit_config inherits the
        // default: no committed-config concept, so it reports no commit.
        struct Dummy;
        impl SyncBackend for Dummy {
            fn kind(&self) -> BackendKind {
                BackendKind::Git
            }
            fn status(&self) -> Result<StatusReport, SyncError> {
                Err(SyncError::NotConfigured)
            }
            fn sync(&self, _: Option<&str>) -> Result<SyncResult, SyncError> {
                Err(SyncError::NotConfigured)
            }
        }
        // Exercise every method so the trait impl carries no uncovered body.
        assert_eq!(Dummy.kind(), BackendKind::Git);
        assert!(Dummy.status().is_err());
        assert!(Dummy.sync(None).is_err());
        // The point of the test: the default commit_config is a no-op.
        assert!(!Dummy.commit_config().unwrap());
    }

    #[test]
    fn backend_kind_serialises_kebab_case() {
        let v = serde_json::to_value(BackendKind::Git).unwrap();
        assert_eq!(v, serde_json::json!("git"));
        let back: BackendKind = serde_json::from_value(serde_json::json!("git")).unwrap();
        assert_eq!(back, BackendKind::Git);
    }

    #[test]
    fn conflict_policy_serialises_and_round_trips() {
        for policy in [
            ConflictPolicy::Prompt,
            ConflictPolicy::PreferRemote,
            ConflictPolicy::PreferLocal,
        ] {
            let v = serde_json::to_value(policy).unwrap();
            let round: ConflictPolicy = serde_json::from_value(v).unwrap();
            assert_eq!(round, policy);
        }
    }

    #[test]
    fn conflict_policy_default_is_prompt() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::Prompt);
    }

    #[test]
    fn status_report_serialises_camel_case() {
        let r = StatusReport {
            kind: BackendKind::Git,
            clean: false,
            ahead: 2,
            behind: 1,
            conflicts: vec!["a.md".into()],
            last_sync_unix: Some(1_700_000_000),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["kind"], "git");
        assert_eq!(v["lastSyncUnix"], 1_700_000_000);
        assert_eq!(v["conflicts"], serde_json::json!(["a.md"]));
        assert_eq!(v["clean"], false);
        assert_eq!(v["ahead"], 2);
        assert_eq!(v["behind"], 1);
    }

    #[test]
    fn sync_result_serialises_camel_case() {
        let r = SyncResult {
            kind: BackendKind::Git,
            pulled_count: 3,
            committed_count: 1,
            pushed_count: 1,
            conflicts: vec![],
            completed_unix: 1_700_000_500,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["kind"], "git");
        assert_eq!(v["pulledCount"], 3);
        assert_eq!(v["committedCount"], 1);
        assert_eq!(v["pushedCount"], 1);
        assert_eq!(v["completedUnix"], 1_700_000_500);
    }
}
