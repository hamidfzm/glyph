//! Moving a setup between this machine's stores and the clone: reading what a
//! commit holds, writing the export into the working tree, and landing a
//! finished sync back in the stores.
//!
//! `state.json` names the commit the stores last matched (`landed`). Every
//! landing is three-way against that commit, and it moves forward the moment
//! an export is committed, before anything reaches the network. A sync that
//! fails after its merge therefore leaves a commit that is simply landed on
//! the next run, instead of one the next export would write over.

use std::collections::{BTreeMap, BTreeSet};

use git2::{Oid, Repository, Tree};

use crate::commands::plugins::is_well_formed_id;
use crate::sync::{SyncError, SyncResult};

use super::config::{save_state, LocalState, Phase, RepoPaths};
use super::files::{self, head_tree, read_folder, SkippedFile, PLUGINS_DIR, SETTINGS_DIR};
use super::flow::SettingsSyncOutcome;
use super::local::{LocalPlugin, LocalSetup, Object};
use super::plugins::{self, Mode, PluginPlan, Pulled, SyncedInstalls, MAX_PLUGIN_FILES};
use super::settings::{self, SYNCED_GROUPS};

/// The repo's files at one commit.
pub(super) struct Snapshot {
    settings: BTreeMap<String, Object>,
    /// Groups whose file is there but could not be read.
    unreadable: BTreeSet<String>,
    pub(super) plugins: Pulled,
    skipped: Vec<SkippedFile>,
}

/// The files at HEAD.
pub(super) fn snapshot(repo: &Repository) -> Result<Snapshot, SyncError> {
    Ok(snapshot_of(repo, head_tree(repo)?.as_ref()))
}

fn snapshot_of(repo: &Repository, tree: Option<&Tree<'_>>) -> Snapshot {
    let settings = read_folder(
        repo,
        tree,
        SETTINGS_DIR,
        settings::is_synced_group,
        SYNCED_GROUPS.len(),
    );
    let plugins = plugins::parse(read_folder(
        repo,
        tree,
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
    Snapshot {
        settings: settings.files,
        unreadable,
        plugins,
        skipped,
    }
}

fn head_id(repo: &Repository) -> Option<String> {
    repo.head().ok()?.target().map(|id| id.to_string())
}

/// Record that the stores match HEAD.
pub(super) fn mark_landed(
    paths: &RepoPaths,
    repo: &Repository,
    state: &mut LocalState,
) -> Result<(), SyncError> {
    state.landed = head_id(repo);
    save_state(paths, state)
}

/// Land HEAD when the stores do not match it yet: a sync that failed after
/// its merge, or a resolution whose push failed, left it there.
pub(super) fn catch_up(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    repo: &Repository,
    state: &mut LocalState,
) -> Result<(), SyncError> {
    let head = head_id(repo);
    if head.is_none() || state.landed == head {
        return Ok(());
    }
    let landed = state
        .landed
        .as_deref()
        .and_then(|id| Oid::from_str(id).ok())
        .and_then(|id| repo.find_commit(id).ok())
        .and_then(|commit| commit.tree().ok());
    // Without the commit the stores last matched there is nothing to tell a
    // remote change from a local one; the stores stand.
    if let Some(landed) = landed {
        let base = snapshot_of(repo, Some(&landed));
        let merged = snapshot(repo)?;
        if let Some(plugin_ids) = land(local, &merged, &Landing::Merge(&base))? {
            local.announce(plugin_ids);
        }
    }
    mark_landed(paths, repo, state)
}

/// How a finished sync lands in the stores.
pub(super) enum Landing<'a> {
    /// The repo holds this machine's setup already.
    Nothing,
    /// Three-way against the commit the stores last matched.
    Merge(&'a Snapshot),
    /// Take the synced setup whole.
    Adopt,
}

/// Write this machine's setup into the working tree. `head` is what the repo
/// holds now; `Replace` also removes whatever this machine does not have.
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
        &head.plugins,
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

/// Land a finished sync in the stores, tell the windows, and record what the
/// stores now match. A sync that stopped on conflicts lands nothing: the tree
/// holds conflict markers until they are resolved.
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
    let state = LocalState {
        landed: head_id(repo),
        installs: plugins::after_sync(installed, &merged.plugins.present, previous),
    };
    save_state(paths, &state)?;
    Ok(SettingsSyncOutcome {
        phase: Phase::Active,
        result: Some(result),
        conflicts: vec![],
        plugins: plugins::plan(
            &merged.plugins,
            &local.installed_plugins()?,
            &state.installs,
        ),
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
