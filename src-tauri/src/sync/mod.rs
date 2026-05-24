//! Workspace sync. See [`backend::SyncBackend`] for the contract every
//! backend must honour, and [`git::GitBackend`] for the Git-over-libgit2
//! implementation that ships in v1. [`commands`] holds the Tauri command
//! surface; [`state::SyncState`] is the managed-state struct the commands
//! read and write through.

#![allow(dead_code, unused_imports)]

mod backend;
pub mod commands;
mod config;
mod error;
pub mod git;
mod ops;
mod state;

pub use backend::{BackendKind, ConflictPolicy, StatusReport, SyncBackend, SyncResult};
pub use config::{CommitIdentity, WorkspaceSyncConfig};
pub use error::SyncError;
pub use state::SyncState;

/// Default branch name Glyph uses for new workspaces and as the canonical
/// branch in test fixtures. Centralised here so every call site stays in
/// lockstep — change it once and both the `WorkspaceSyncConfig` default and
/// every fixture's `init_repo` / `init_bare` agree.
pub const DEFAULT_REMOTE_BRANCH: &str = "main";
