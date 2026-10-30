//! Shared fixtures for the settings repo tests: a bare remote standing in
//! for the cloud, and machines that keep their stores in memory.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;

use git2::Repository;
use serde_json::Value;
use tempfile::TempDir;

use crate::commands::plugins::{InstallMarker, InstallSource};
use crate::sync::{CommitIdentity, SyncError, DEFAULT_REMOTE_BRANCH};

use super::config::{Phase, RepoPaths, SettingsRepoConfig};
use super::local::{LocalPlugin, LocalSetup, Object};

pub(super) fn object(value: Value) -> Object {
    serde_json::from_value(value).expect("an object")
}

/// A bare repository every machine of a test syncs through.
pub(super) struct Cloud {
    pub(super) tmp: TempDir,
    pub(super) remote: PathBuf,
}

impl Cloud {
    pub(super) fn new() -> Self {
        let tmp = TempDir::new().unwrap();
        let remote = tmp.path().join("remote.git");
        let mut opts = git2::RepositoryInitOptions::new();
        opts.bare(true);
        opts.initial_head(DEFAULT_REMOTE_BRANCH);
        Repository::init_opts(&remote, &opts).unwrap();
        Self { tmp, remote }
    }

    pub(super) fn config(&self) -> SettingsRepoConfig {
        SettingsRepoConfig {
            remote_url: self.remote.to_string_lossy().into_owned(),
            branch: DEFAULT_REMOTE_BRANCH.into(),
            author: Some(CommitIdentity {
                name: "Test User".into(),
                email: "test@example.com".into(),
            }),
            phase: Phase::Active,
        }
    }

    /// Where machine `name` keeps its settings repo.
    pub(super) fn paths(&self, name: &str) -> RepoPaths {
        RepoPaths::under(&self.tmp.path().join(name))
    }

    /// `path` as the remote's branch holds it now.
    pub(super) fn file(&self, path: &str) -> Option<String> {
        let repo = Repository::open(&self.remote).unwrap();
        let tree = repo
            .find_reference("refs/heads/main")
            .ok()?
            .peel_to_tree()
            .unwrap();
        let entry = tree.get_path(std::path::Path::new(path)).ok()?;
        let blob = repo.find_blob(entry.id()).unwrap();
        Some(String::from_utf8_lossy(blob.content()).into_owned())
    }

    /// The text of every blob in every commit the remote's branch reaches.
    pub(super) fn every_blob(&self) -> String {
        let repo = Repository::open(&self.remote).unwrap();
        let mut walk = repo.revwalk().unwrap();
        walk.push_ref("refs/heads/main").unwrap();
        let mut text = String::new();
        for oid in walk {
            let tree = repo.find_commit(oid.unwrap()).unwrap().tree().unwrap();
            tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
                if let Ok(blob) = repo.find_blob(entry.id()) {
                    text.push_str(&String::from_utf8_lossy(blob.content()));
                }
                git2::TreeWalkResult::Ok
            })
            .unwrap();
        }
        text
    }
}

/// A machine whose stores live in memory.
#[derive(Default)]
pub(super) struct Machine {
    settings: Mutex<Object>,
    plugin_settings: Mutex<Object>,
    disabled: Mutex<BTreeSet<String>>,
    installed: Mutex<Vec<LocalPlugin>>,
    announced: Mutex<Vec<Vec<String>>>,
    reads: Mutex<usize>,
    /// An edit to apply when settings are read for the given time: the
    /// user changing a setting while a sync runs.
    edit_on_read: Mutex<Option<(usize, String, Value)>>,
    /// A settings store that fails every write.
    refuse_writes: Mutex<bool>,
}

impl Machine {
    pub(super) fn with_settings(settings: Value) -> Self {
        let machine = Self::default();
        *machine.settings.lock().unwrap() = object(settings);
        machine
    }

    pub(super) fn settings_now(&self) -> Object {
        self.settings.lock().unwrap().clone()
    }

    pub(super) fn set_group(&self, group: &str, value: Value) {
        self.settings.lock().unwrap().insert(group.into(), value);
    }

    pub(super) fn plugin_settings_now(&self) -> Object {
        self.plugin_settings.lock().unwrap().clone()
    }

    pub(super) fn set_plugin_setting(&self, id: &str, value: Value) {
        self.plugin_settings
            .lock()
            .unwrap()
            .insert(id.into(), value);
    }

    pub(super) fn install(&self, id: &str, installed_at: u64) {
        let mut installed = self.installed.lock().unwrap();
        installed.retain(|p| p.id != id);
        installed.push(LocalPlugin {
            id: id.into(),
            version: Some("1.0.0".into()),
            marker: Some(InstallMarker {
                source: InstallSource::Marketplace,
                installed_at,
            }),
        });
    }

    /// A plugin folder whose manifest cannot be read right now.
    pub(super) fn install_unreadable(&self, id: &str, installed_at: u64) {
        self.install(id, installed_at);
        let mut installed = self.installed.lock().unwrap();
        installed.iter_mut().for_each(|p| {
            if p.id == id {
                p.version = None;
            }
        });
    }

    pub(super) fn uninstall(&self, id: &str) {
        self.installed.lock().unwrap().retain(|p| p.id != id);
    }

    pub(super) fn disable(&self, id: &str) {
        self.disabled.lock().unwrap().insert(id.into());
    }

    pub(super) fn announced(&self) -> Vec<Vec<String>> {
        self.announced.lock().unwrap().clone()
    }

    /// Change `group` the `nth` time settings are read (1-based).
    pub(super) fn edit_on_read(&self, nth: usize, group: &str, value: Value) {
        *self.reads.lock().unwrap() = 0;
        *self.edit_on_read.lock().unwrap() = Some((nth, group.into(), value));
    }

    pub(super) fn refuse_writes(&self, refuse: bool) {
        *self.refuse_writes.lock().unwrap() = refuse;
    }
}

impl LocalSetup for Machine {
    fn settings(&self) -> Result<Object, SyncError> {
        let mut reads = self.reads.lock().unwrap();
        *reads += 1;
        let mut edit = self.edit_on_read.lock().unwrap();
        if matches!(&*edit, Some((nth, _, _)) if *nth == *reads) {
            let (_, group, value) = edit.take().unwrap();
            self.set_group(&group, value);
        }
        Ok(self.settings_now())
    }

    fn set_settings(&self, settings: Object) -> Result<(), SyncError> {
        if *self.refuse_writes.lock().unwrap() {
            return Err(SyncError::Backend("the store refused the write".into()));
        }
        *self.settings.lock().unwrap() = settings;
        Ok(())
    }

    fn plugin_settings(&self) -> Result<Object, SyncError> {
        Ok(self.plugin_settings_now())
    }

    fn set_plugin_settings(&self, settings: Object) -> Result<(), SyncError> {
        *self.plugin_settings.lock().unwrap() = settings;
        Ok(())
    }

    fn disabled_plugins(&self) -> Result<BTreeSet<String>, SyncError> {
        Ok(self.disabled.lock().unwrap().clone())
    }

    fn installed_plugins(&self) -> Result<Vec<LocalPlugin>, SyncError> {
        let mut installed = self.installed.lock().unwrap().clone();
        installed.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(installed)
    }

    fn announce(&self, plugin_ids: Vec<String>) {
        self.announced.lock().unwrap().push(plugin_ids);
    }
}
