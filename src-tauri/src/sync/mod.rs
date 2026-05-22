//! Workspace sync. See [`backend::SyncBackend`] for the contract every
//! backend must honour, and [`git::GitBackend`] for the Git-over-libgit2
//! implementation that ships in v1.
//!
//! This module ships standalone in this PR — no Tauri commands invoke
//! it yet. The follow-up PR layers in the IPC surface and the
//! settings UI. `dead_code` is allowed at the module level so the trait
//! / config / git impl can land + be tested without spurious warnings
//! about "no caller".

#![allow(dead_code, unused_imports)]

mod backend;
mod config;
mod error;
pub mod git;

pub use backend::{BackendKind, ConflictPolicy, StatusReport, SyncBackend, SyncResult};
pub use config::{CommitIdentity, WorkspaceSyncConfig};
pub use error::SyncError;
