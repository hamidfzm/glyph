//! The settings repo's operations, start to finish. Each runs on a blocking
//! thread while its caller holds the repo's lock.
//!
//! The clone is disposable: this machine's stores are the source of truth,
//! so connecting and the first-connect choice start from a fresh repository
//! and a sync always exports before it pulls.

use std::fs;
use std::io::ErrorKind;

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::sync::git::{self, BoundToken, ConflictPick, GitBackend};
use crate::sync::{StatusReport, SyncBackend, SyncError, SyncResult};

use super::config::{load_config, read_json, save_config, Phase, RepoPaths, SettingsRepoConfig};
use super::exchange::{finish, snapshot, write_export, Landing};
use super::files::{self, SkippedFile, PLUGINS_DIR};
use super::local::{LocalPlugin, LocalSetup};
use super::plugins::{self, Mode, PluginPlan, SyncedInstalls};

/// The answer to "this repo already holds a setup".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetupChoice {
    /// Replace this machine's settings with the synced ones.
    UseSynced,
    /// Replace the synced setup with this machine's.
    ReplaceSynced,
}

/// What an operation did, for the Sync tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSyncOutcome {
    pub phase: Phase,
    /// `None` when nothing synced: a connect that found a setup to choose
    /// about.
    pub result: Option<SyncResult>,
    /// Files to pick a side for before the next sync.
    pub conflicts: Vec<String>,
    /// Repo files the import left out, and why.
    pub skipped: Vec<SkippedFile>,
    pub plugins: PluginPlan,
}

/// Connect to `config`'s remote. An empty remote gets this machine's setup;
/// one that holds a setup waits for [`choose`]. A connect that fails leaves
/// nothing behind.
pub(super) fn connect(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    config: SettingsRepoConfig,
    token: Option<BoundToken>,
) -> Result<SettingsSyncOutcome, SyncError> {
    if load_config(paths)?.is_some() {
        return Err(SyncError::InvalidState(
            "already connected; disconnect first".into(),
        ));
    }
    let outcome = connect_fresh(paths, local, config, token);
    if outcome.is_err() {
        // Best-effort: the connect's own error is the one to report.
        let _ = forget(paths);
    }
    outcome
}

fn connect_fresh(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    config: SettingsRepoConfig,
    token: Option<BoundToken>,
) -> Result<SettingsSyncOutcome, SyncError> {
    fresh_clone(paths, &config)?;
    let backend = backend(paths, &config, token);
    if backend.remote_branch_exists()? {
        save_config(paths, &with_phase(config, Phase::Choosing))?;
        return Ok(SettingsSyncOutcome {
            phase: Phase::Choosing,
            result: None,
            conflicts: vec![],
            skipped: vec![],
            plugins: PluginPlan::default(),
        });
    }
    let outcome = upload(paths, local, &backend)?;
    save_config(paths, &with_phase(config, Phase::Active))?;
    Ok(outcome)
}

/// Answer the first-connect question, from a fresh clone of the remote.
pub(super) fn choose(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    token: Option<BoundToken>,
    choice: SetupChoice,
) -> Result<SettingsSyncOutcome, SyncError> {
    let config = load_config(paths)?.ok_or(SyncError::NotConfigured)?;
    if config.phase != Phase::Choosing {
        return Err(SyncError::InvalidState(
            "this machine already chose how to start".into(),
        ));
    }
    fresh_clone(paths, &config)?;
    let backend = backend(paths, &config, token);
    // The fresh clone has nothing to commit, so this fast-forwards onto the
    // remote.
    let pulled = backend.sync(None)?;
    let outcome = match choice {
        SetupChoice::UseSynced => {
            let repo = backend.open_repo()?;
            let installed = local.installed_plugins();
            let fresh = SyncedInstalls::default();
            finish(
                paths,
                local,
                &repo,
                &installed,
                &fresh,
                pulled,
                Landing::Adopt,
            )?
        }
        SetupChoice::ReplaceSynced => upload(paths, local, &backend)?,
    };
    save_config(paths, &with_phase(config, Phase::Active))?;
    Ok(outcome)
}

/// Sync now: export, sync, and land what came back.
pub(super) fn run(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    token: Option<BoundToken>,
) -> Result<SettingsSyncOutcome, SyncError> {
    let config = active_config(paths)?;
    let backend = backend(paths, &config, token);
    let repo = backend.open_repo()?;
    // Nothing is written into a tree that still holds conflict markers.
    let pending = backend.status()?.conflicts;
    if !pending.is_empty() {
        return Err(SyncError::Conflict(pending));
    }
    let base = snapshot(&repo)?;
    let previous = load_state(paths)?;
    let installed = local.installed_plugins();
    write_export(paths, local, &base, &installed, &previous, Mode::Merge)?;
    let mut result = backend.sync(None)?;
    if result.conflicts.is_empty() {
        result =
            restore_new_installs(paths, local, &repo, &backend, &installed, &previous, result)?;
    }
    let landing = Landing::Merge(&base);
    finish(paths, local, &repo, &installed, &previous, result, landing)
}

/// A merge can take out the file of a plugin installed here since the last
/// sync, when another machine removed the same id meanwhile. Write those back
/// and sync again, so a fresh install is never lost to an older removal.
fn restore_new_installs(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    repo: &Repository,
    backend: &GitBackend,
    installed: &[LocalPlugin],
    previous: &SyncedInstalls,
    first: SyncResult,
) -> Result<SyncResult, SyncError> {
    let after = snapshot(repo)?;
    let restored = plugins::restore(
        installed,
        &local.disabled_plugins()?,
        &local.plugin_settings()?,
        &after.plugins.present,
        previous,
    );
    if restored.is_empty() {
        return Ok(first);
    }
    for (id, entry) in &restored {
        files::write_object(&paths.repo(), PLUGINS_DIR, id, entry)?;
    }
    let again = backend.sync(None)?;
    Ok(SyncResult {
        pulled_count: first.pulled_count + again.pulled_count,
        committed_count: first.committed_count + again.committed_count,
        pushed_count: first.pushed_count + again.pushed_count,
        ..again
    })
}

/// Finish a merge that stopped on conflicts with one pick per file.
pub(super) fn resolve(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    token: Option<BoundToken>,
    picks: &[ConflictPick],
) -> Result<SettingsSyncOutcome, SyncError> {
    let config = active_config(paths)?;
    let backend = backend(paths, &config, token);
    let repo = backend.open_repo()?;
    // HEAD is still this machine's side of the merge: the export the
    // conflict came from, so edits made since then are kept.
    let base = snapshot(&repo)?;
    let previous = load_state(paths)?;
    let installed = local.installed_plugins();
    let result = backend.resolve_conflicts(picks)?;
    let landing = Landing::Merge(&base);
    finish(paths, local, &repo, &installed, &previous, result, landing)
}

pub(super) fn status(
    paths: &RepoPaths,
    token: Option<BoundToken>,
) -> Result<StatusReport, SyncError> {
    let config = active_config(paths)?;
    backend(paths, &config, token).status()
}

/// The plugin plan as the repo stands, without touching the network.
pub(super) fn plugin_plan(
    paths: &RepoPaths,
    local: &impl LocalSetup,
) -> Result<PluginPlan, SyncError> {
    let config = match load_config(paths)? {
        Some(config) if config.phase == Phase::Active => config,
        _ => return Ok(PluginPlan::default()),
    };
    let repo = backend(paths, &config, None).open_repo()?;
    let snapshot = snapshot(&repo)?;
    Ok(plugins::plan(
        &snapshot.plugins,
        &local.installed_plugins(),
        &load_state(paths)?,
    ))
}

/// Drop the config, the bookkeeping and the clone. The remote keeps
/// everything; this machine's settings and plugins stay as they are.
pub(super) fn forget(paths: &RepoPaths) -> Result<(), SyncError> {
    already_gone_is_done(fs::remove_dir_all(paths.root()))
}

/// Export this machine's whole setup over whatever the repo holds, and push.
fn upload(
    paths: &RepoPaths,
    local: &impl LocalSetup,
    backend: &GitBackend,
) -> Result<SettingsSyncOutcome, SyncError> {
    let repo = backend.open_repo()?;
    let head = snapshot(&repo)?;
    let installed = local.installed_plugins();
    let fresh = SyncedInstalls::default();
    write_export(paths, local, &head, &installed, &fresh, Mode::Replace)?;
    let result = backend.sync(None)?;
    finish(
        paths,
        local,
        &repo,
        &installed,
        &fresh,
        result,
        Landing::Nothing,
    )
}

fn with_phase(config: SettingsRepoConfig, phase: Phase) -> SettingsRepoConfig {
    SettingsRepoConfig { phase, ..config }
}

fn active_config(paths: &RepoPaths) -> Result<SettingsRepoConfig, SyncError> {
    let config = load_config(paths)?.ok_or(SyncError::NotConfigured)?;
    if config.phase != Phase::Active {
        return Err(SyncError::InvalidState(
            "choose whether to use the synced setup first".into(),
        ));
    }
    Ok(config)
}

fn load_state(paths: &RepoPaths) -> Result<SyncedInstalls, SyncError> {
    Ok(read_json(&paths.state())?.unwrap_or_default())
}

fn backend(
    paths: &RepoPaths,
    config: &SettingsRepoConfig,
    token: Option<BoundToken>,
) -> GitBackend {
    let backend = GitBackend::new(config.backend_config(paths));
    match token {
        Some(token) => backend.with_https_token(token),
        None => backend,
    }
}

/// A new, empty repository following `config`'s remote, in place of any
/// earlier clone, and no record of earlier syncs.
fn fresh_clone(paths: &RepoPaths, config: &SettingsRepoConfig) -> Result<(), SyncError> {
    let repo_dir = paths.repo();
    already_gone_is_done(fs::remove_dir_all(&repo_dir))?;
    already_gone_is_done(fs::remove_file(paths.state()))?;
    fs::create_dir_all(&repo_dir)?;
    git::init_repo(&repo_dir, &config.branch)?;
    git::pin_checkout_config(&repo_dir)?;
    git::set_origin(&repo_dir, &config.remote_url)
}

/// A removal of something that was not there has nothing left to do.
fn already_gone_is_done(removal: std::io::Result<()>) -> Result<(), SyncError> {
    match removal {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}
