//! The settings repo: one git remote, separate from every workspace, that
//! carries the user's portable setup between machines.
//!
//! Everything lives under `<app data>/settings-sync/`, which this module
//! creates and owns: `config.json` (remote, branch, author, phase),
//! `state.json` (the plugin installs this machine last synced) and `repo/`,
//! the clone. No command takes a path, so the renderer never names a folder
//! libgit2 opens.
//!
//! The clone holds `settings/<group>.json` for each synced settings group and
//! `plugins/<id>.json` for each plugin. [`settings`] decides what leaves the
//! machine and how a pull lands, [`plugins`] does the same for plugin files,
//! [`files`] reads a commit's files and writes the working tree, [`exchange`]
//! moves a setup between the stores and the clone, [`flow`] runs connect,
//! sync, the first-connect choice and conflict resolution, and [`commands`]
//! is the IPC surface.

pub mod commands;
mod config;
mod exchange;
mod files;
mod flow;
mod local;
mod plugins;
mod settings;
mod state;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use state::SettingsSyncState;

/// Event every window hears after an import changed settings on disk, with
/// the ids of the plugins whose settings changed.
pub const SETTINGS_SYNCED_EVENT: &str = "settings-synced";
