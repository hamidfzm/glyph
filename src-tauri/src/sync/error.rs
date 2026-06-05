//! Common error type for every sync backend.
//!
//! Each variant is something the UI can act on:
//! - `NotConfigured` → prompt the user to set up sync for this workspace.
//! - `AuthFailed` → ask for credentials again.
//! - `Network` → surface a retryable "couldn't reach the remote" notice.
//! - `Conflict` → open the conflict-resolution UI (future PR).
//! - `Io` and `Backend` → log and show a generic error.
//!
//! Backends should map their library-specific failures into these
//! variants instead of leaking implementation-detail strings.

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "kebab-case")]
pub enum SyncError {
    #[error("sync is not configured for this workspace")]
    NotConfigured,

    #[error("authentication failed: {0}")]
    AuthFailed(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("conflict in {} file(s); resolve before syncing again", .0.len())]
    Conflict(Vec<String>),

    #[error("repository is in a state we don't understand: {0}")]
    InvalidState(String),

    #[error("i/o error: {0}")]
    Io(String),

    #[error("backend error: {0}")]
    Backend(String),
}

impl From<std::io::Error> for SyncError {
    fn from(e: std::io::Error) -> Self {
        SyncError::Io(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_messages_describe_each_variant() {
        assert_eq!(
            SyncError::NotConfigured.to_string(),
            "sync is not configured for this workspace"
        );
        assert_eq!(
            SyncError::AuthFailed("bad token".to_string()).to_string(),
            "authentication failed: bad token"
        );
        assert_eq!(
            SyncError::Network("timeout".to_string()).to_string(),
            "network error: timeout"
        );
        assert_eq!(
            SyncError::Conflict(vec!["a.md".to_string(), "b.md".to_string()]).to_string(),
            "conflict in 2 file(s); resolve before syncing again"
        );
        assert_eq!(
            SyncError::InvalidState("detached HEAD".to_string()).to_string(),
            "repository is in a state we don't understand: detached HEAD"
        );
        assert_eq!(
            SyncError::Io("disk full".to_string()).to_string(),
            "i/o error: disk full"
        );
        assert_eq!(
            SyncError::Backend("libgit2 boom".to_string()).to_string(),
            "backend error: libgit2 boom"
        );
    }

    #[test]
    fn io_error_converts_via_from() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let sync_err: SyncError = err.into();
        assert!(matches!(sync_err, SyncError::Io(msg) if msg.contains("missing")));
    }

    #[test]
    fn serialises_to_tagged_object_for_the_frontend() {
        let json = serde_json::to_value(SyncError::NotConfigured).unwrap();
        assert_eq!(json["kind"], "not-configured");
        let json = serde_json::to_value(SyncError::AuthFailed("nope".into())).unwrap();
        assert_eq!(json["kind"], "auth-failed");
        assert_eq!(json["message"], "nope");
        let json = serde_json::to_value(SyncError::Conflict(vec!["x".into()])).unwrap();
        assert_eq!(json["kind"], "conflict");
        assert_eq!(json["message"], serde_json::json!(["x"]));
    }
}
