//! Workspace sync. See [`backend::SyncBackend`] for the contract every
//! backend must honour, and [`git::GitBackend`] for the Git-over-libgit2
//! implementation that ships in v1. [`commands`] holds the Tauri command
//! surface; [`state::SyncState`] is the managed-state struct the commands
//! read and write through.

#![allow(dead_code, unused_imports)]

mod backend;
// The git backend (git2 + vendored OpenSSL) doesn't cross-compile for
// android/ios, so everything that touches it is desktop-only; mobile gets
// stub commands and an empty state so the command surface stays identical.
#[cfg(desktop)]
pub mod commands;
#[cfg(mobile)]
#[path = "commands_mobile.rs"]
pub mod commands;
mod config;
mod error;
#[cfg(desktop)]
pub mod git;
#[cfg(desktop)]
mod ops;
#[cfg(desktop)]
mod state;
#[cfg(mobile)]
#[path = "state_mobile.rs"]
mod state;

pub use backend::{BackendKind, ConflictPolicy, StatusReport, SyncBackend, SyncResult};
pub use config::{CommitAuthorHint, CommitIdentity, WorkspaceSyncConfig};
pub use error::SyncError;
pub use state::SyncState;

/// Default branch name Glyph uses for new workspaces and as the canonical
/// branch in test fixtures. Centralised here so every call site stays in
/// lockstep — change it once and both the `WorkspaceSyncConfig` default and
/// every fixture's `init_repo` / `init_bare` agree.
pub const DEFAULT_REMOTE_BRANCH: &str = "main";
