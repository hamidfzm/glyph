//! Moving a setup between this machine's stores and the clone: reading what a
//! commit holds, writing the export into the working tree, and landing a
//! finished sync back in the stores.

use std::collections::{BTreeMap, BTreeSet};

use git2::Repository;

use crate::commands::plugins::is_well_formed_id;
use crate::sync::{SyncError, SyncResult};

use super::config::{write_json, Phase, RepoPaths};
use super::files::{self, head_tree, read_folder, SkippedFile, PLUGINS_DIR, SETTINGS_DIR};
use super::flow::SettingsSyncOutcome;
use super::local::{LocalPlugin, LocalSetup, Object};
use super::plugins::{self, Mode, PluginPlan, Pulled, SyncedInstalls, MAX_PLUGIN_FILES};
use super::settings::{self, SYNCED_GROUPS};

/// The repo's files at HEAD.
pub(super) struct Snapshot {
    settings: BTreeMap<String, Object>,
    /// Groups whose file is there but could not be read.
    unreadable: BTreeSet<String>,
    pub(super) plugins: Pulled,
    skipped: Vec<SkippedFile>,
}

pub(super) fn snapshot(repo: &Repository) -> Result<Snapshot, SyncError> {
    let tree = head_tree(repo)?;
    let settings = read_folder(
        repo,
        tree.as_ref(),
        SETTINGS_DIR,
        settings::is_synced_group,
        SYNCED_GROUPS.len(),
    );
    let plugins = plugins::parse(read_folder(
        repo,
        tree.as_ref(),
        PLUGINS_DIR,
        is_well_formed_id,
        MAX_PLUGIN_FILES,
    ));
    let unreadable = settings
        .present
        .iter()
        .filter(|group| !settings.files.contains_key(*group))
        .cloned()
        .collect();
    let mut skipped = settings.skipped;
    skipped.extend(plugins.skipped.iter().cloned());
    Ok(Snapshot {
        settings: settings.files,
        unreadable,
        plugins,
        skipped,
    })
}

/// How a finished sync lands in the stores.
pub(super) enum Landing<'a> {
    /// The repo holds this machine's setup already.
    Nothing,
    /// Three-way against what the repo held before the sync.
    Merge(&'a Snapshot),
    /// Take the synced setup whole.
    Adopt,
}

/// Write this machine's setup into the working tree. `head` is what the repo
/// held before; `Replace` also removes whatever this machine does not have.
pub(super) fn write_export(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    head: &Snapshot,
    installed: &[LocalPlugin],
    previous: &SyncedInstalls,
    mode: Mode,
) -> Result<(), SyncError> {
    let repo_dir = paths.repo();
    let groups = settings::export(&local.settings()?);
    for group in SYNCED_GROUPS {
        match groups.get(group) {
            Some(value) => files::write_object(&repo_dir, SETTINGS_DIR, group, value)?,
            None if mode == Mode::Replace => files::remove_object(&repo_dir, SETTINGS_DIR, group)?,
            None => {}
        }
    }
    let export = plugins::export(
        installed,
        &local.disabled_plugins()?,
        &local.plugin_settings()?,
        &head.plugins.present,
        previous,
        mode,
    );
    for (id, entry) in &export.writes {
        files::write_object(&repo_dir, PLUGINS_DIR, id, entry)?;
    }
    for id in &export.removes {
        files::remove_object(&repo_dir, PLUGINS_DIR, id)?;
    }
    Ok(())
}

/// Land a finished sync in the stores, tell the windows, and record which
/// installs the repo now holds. A sync that stopped on conflicts lands
/// nothing: the tree holds conflict markers until they are resolved.
pub(super) fn finish(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    repo: &Repository,
    installed: &[LocalPlugin],
    previous: &SyncedInstalls,
    result: SyncResult,
    landing: Landing<'_>,
) -> Result<SettingsSyncOutcome, SyncError> {
    if !result.conflicts.is_empty() {
        return Ok(SettingsSyncOutcome {
            phase: Phase::Active,
            conflicts: result.conflicts.clone(),
            result: Some(result),
            skipped: vec![],
            plugins: PluginPlan::default(),
        });
    }
    let merged = snapshot(repo)?;
    if let Some(plugin_ids) = land(local, &merged, &landing)? {
        local.announce(plugin_ids);
    }
    let state = plugins::after_sync(installed, &merged.plugins.present, previous);
    write_json(&paths.state(), &state)?;
    Ok(SettingsSyncOutcome {
        phase: Phase::Active,
        result: Some(result),
        conflicts: vec![],
        plugins: plugins::plan(&merged.plugins, &local.installed_plugins(), &state),
        skipped: merged.skipped,
    })
}

/// Write the merged setup into the stores. `Some` (with the plugins whose
/// settings changed) when anything was written.
fn land(
    local: &impl LocalSetup,
    merged: &Snapshot,
    landing: &Landing<'_>,
) -> Result<Option<Vec<String>>, SyncError> {
    let store = local.settings()?;
    let plugin_store = local.plugin_settings()?;
    let (next, (next_plugins, plugin_ids)) = match landing {
        Landing::Nothing => return Ok(None),
        Landing::Merge(base) => (
            settings::import(&store, &base.settings, &merged.settings, &merged.unreadable),
            plugins::import_settings(
                &plugin_store,
                &base.plugins.settings,
                &merged.plugins.settings,
            ),
        ),
        Landing::Adopt => (
            settings::adopt(&store, &merged.settings, &merged.unreadable),
            plugins::adopt_settings(&plugin_store, &merged.plugins.settings),
        ),
    };
    let settings_changed = next != store;
    if settings_changed {
        local.set_settings(next)?;
    }
    let plugins_changed = !plugin_ids.is_empty();
    if plugins_changed {
        local.set_plugin_settings(next_plugins)?;
    }
    Ok((settings_changed || plugins_changed).then_some(plugin_ids))
}
