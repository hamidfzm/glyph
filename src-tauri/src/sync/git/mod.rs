//! Git-backed sync. Built on `git2` (statically-linked libgit2) so end
//! users don't need a system `git` install — the entire backend ships
//! inside the Glyph binary.
//!
//! Sync flow when [`GitBackend::sync`] is called:
//!
//! 1. Stage every change in the working tree (`git add -A`).
//! 2. If there is anything staged, create a `glyph: auto-commit` commit
//!    on the current branch using the configured author identity (or
//!    libgit2's global config as a fallback).
//! 3. Fetch the configured remote branch.
//! 4. Fast-forward when possible. If fast-forward isn't possible, merge
//!    the remote into the local branch with libgit2's merge analysis:
//!    success → commit the merge; conflicts → surface them in
//!    [`super::backend::SyncResult::conflicts`] and stop without pushing
//!    so the user can resolve.
//! 5. Push the local branch to the remote.
//!
//! Status is computed without touching the network: it counts dirty
//! files in the index, then compares the current branch's tip against
//! its upstream's last-known SHA for ahead / behind. The next sync call
//! fetches and recomputes from real refs.
//!
//! Credentials: for v1 we only handle HTTPS + a static PAT-style token.
//! SSH-agent / per-key flows land in a follow-up PR; the credential
//! callback in this module is where they will attach.
//!
//! The implementation is split across sibling files: [`backend`] holds the
//! `GitBackend` type and its `SyncBackend` impl, [`message`] the GitHub-style
//! auto-commit subject, [`credentials`] the libgit2 credential callback, and
//! [`repo`] the repository-lifecycle helpers (`init` / `clone` / `set_origin`).

mod backend;
mod credentials;
mod message;
mod repo;

pub use backend::GitBackend;
pub use credentials::{make_credentials_callback, select_credentials};
pub use message::auto_commit_message;
pub use repo::{clone_repo, init_repo, set_origin};

use std::time::{SystemTime, UNIX_EPOCH};

use crate::sync::SyncError;

/// Remote name we look up; matches `git clone`'s default.
pub(super) const ORIGIN: &str = "origin";

/// Fallback commit subject when an auto-commit's diff comes back empty.
/// The user always sees a real "you wrote notes" history in their repo,
/// but they don't have to author each commit by hand.
pub(super) fn auto_commit_fallback_message() -> String {
    format!("{}: auto-commit local changes", crate::APP_NAME)
}

/// Subject for the merge commit we create when reconciling remote changes.
pub(super) fn merge_commit_message() -> String {
    format!("{}: merge remote changes", crate::APP_NAME)
}

/// Subject for the setup commit that lands the workspace config directory
/// in history when sync is first enabled.
pub(super) fn config_commit_message() -> String {
    format!("{}: add workspace config", crate::APP_NAME)
}

/// Map a libgit2 transport error into a [`SyncError`] the UI can act on.
pub(super) fn map_remote_error(e: git2::Error) -> SyncError {
    let msg = e.message().to_string();
    match e.class() {
        git2::ErrorClass::Net | git2::ErrorClass::Http => SyncError::Network(msg),
        git2::ErrorClass::Ssh | git2::ErrorClass::Callback => SyncError::AuthFailed(msg),
        _ if msg.contains("authentication") || msg.contains("auth") => SyncError::AuthFailed(msg),
        _ => SyncError::Backend(msg),
    }
}

pub(super) fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
