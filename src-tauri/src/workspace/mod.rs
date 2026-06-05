//! Per-workspace model: a workspace is one git repository's top level, and its
//! Glyph-managed config lives inside it under `.glyph/`.
//!
//! - [`config`] owns the `.glyph/config.json` (committed sync settings,
//!   the source of truth that replaces the in-memory `sync::SyncState`
//!   map) and `.glyph/state.json` (git-ignored volatile last-opened file).
//! - [`paths`] normalizes stored paths to workspace-relative forward slashes.
//! - [`resolve`] implements the "one folder = one non-nested git repo"
//!   guard (#262).
//! - [`commands`] is the Tauri command surface.
//!
//! `sync` depends on this module for config persistence (see
//! [`config::load_sync_config`] / [`config::store_sync_config`]).

pub mod commands;
pub mod config;
mod paths;
mod resolve;

pub use config::{clear_sync_config, load_sync_config, store_sync_config};
