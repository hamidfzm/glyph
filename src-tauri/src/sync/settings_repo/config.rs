//! Where the settings repo keeps its files, and the machine-local config
//! that says which remote it follows.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::sync::{BackendKind, CommitIdentity, ConflictPolicy, SyncError, WorkspaceSyncConfig};

use super::plugins::SyncedInstalls;

/// The folders and files of the settings repo, all under one folder of the
/// app data dir.
#[derive(Debug, Clone)]
pub(super) struct RepoPaths {
    root: PathBuf,
}

impl RepoPaths {
    pub(super) fn under(app_data: &Path) -> Self {
        Self {
            root: app_data.join("settings-sync"),
        }
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    fn config(&self) -> PathBuf {
        self.root.join("config.json")
    }

    pub(super) fn state(&self) -> PathBuf {
        self.root.join("state.json")
    }

    pub(super) fn repo(&self) -> PathBuf {
        self.root.join("repo")
    }
}

/// Where a connection stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// The remote already held a setup when this machine connected; nothing
    /// syncs until the user picks whether to use it or replace it.
    Choosing,
    /// Connected; Sync now runs.
    Active,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRepoConfig {
    pub remote_url: String,
    pub branch: String,
    pub author: Option<CommitIdentity>,
    pub phase: Phase,
}

impl SettingsRepoConfig {
    /// The engine's view of the clone. The path comes from `paths`, never
    /// from the file, so a stray key in `config.json` cannot move it.
    pub(super) fn backend_config(&self, paths: &RepoPaths) -> WorkspaceSyncConfig {
        WorkspaceSyncConfig {
            workspace_path: paths.repo().to_string_lossy().into_owned(),
            backend: BackendKind::Git,
            remote_url: self.remote_url.clone(),
            remote_branch: self.branch.clone(),
            conflict_policy: ConflictPolicy::Prompt,
            author: self.author.clone(),
        }
    }
}

/// What this machine knows of the repo, kept beside the clone: the commit its
/// stores last matched, and the plugin installs its last sync covered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalState {
    #[serde(default)]
    pub(super) landed: Option<String>,
    #[serde(default)]
    pub(super) installs: SyncedInstalls,
}

pub(super) fn load_state(paths: &RepoPaths) -> Result<LocalState, SyncError> {
    Ok(read_json(&paths.state())?.unwrap_or_default())
}

pub(super) fn save_state(paths: &RepoPaths, state: &LocalState) -> Result<(), SyncError> {
    write_json(&paths.state(), state)
}

pub(super) fn load_config(paths: &RepoPaths) -> Result<Option<SettingsRepoConfig>, SyncError> {
    read_json(&paths.config())
}

pub(super) fn save_config(paths: &RepoPaths, config: &SettingsRepoConfig) -> Result<(), SyncError> {
    write_json(&paths.config(), config)
}

/// Read a JSON file the backend wrote. Missing is `None`; a file that does
/// not parse is an error, since only this module writes it.
pub(super) fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, SyncError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| SyncError::Backend(format!("{} is unreadable: {e}", display(path)))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(SyncError::Io(e.to_string())),
    }
}

/// Write `value` beside `path` and move it into place, so a crash never
/// leaves half a file.
pub(super) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), SyncError> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| SyncError::Backend(e.to_string()))?;
    path.parent().map(fs::create_dir_all).transpose()?;
    let partial = path.with_extension("json.partial");
    fs::write(&partial, json)?;
    fs::rename(&partial, path)?;
    Ok(())
}

fn display(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn config() -> SettingsRepoConfig {
        SettingsRepoConfig {
            remote_url: "https://example.com/setup.git".into(),
            branch: "main".into(),
            author: None,
            phase: Phase::Active,
        }
    }

    #[test]
    fn a_saved_config_reads_back_and_a_missing_one_is_none() {
        let tmp = TempDir::new().unwrap();
        let paths = RepoPaths::under(tmp.path());
        assert_eq!(load_config(&paths).unwrap(), None);
        save_config(&paths, &config()).unwrap();
        assert_eq!(load_config(&paths).unwrap(), Some(config()));
    }

    #[test]
    fn the_clone_path_comes_from_the_folder_not_the_file() {
        let tmp = TempDir::new().unwrap();
        let paths = RepoPaths::under(tmp.path());
        let mut raw = serde_json::to_value(config()).unwrap();
        raw["workspacePath"] = "C:/Windows".into();
        fs::create_dir_all(paths.root()).unwrap();
        fs::write(paths.config(), raw.to_string()).unwrap();
        let loaded = load_config(&paths).unwrap().unwrap();
        assert_eq!(
            loaded.backend_config(&paths).workspace_path,
            paths.repo().to_string_lossy()
        );
    }

    #[test]
    fn a_corrupt_config_is_an_error_not_a_missing_one() {
        let tmp = TempDir::new().unwrap();
        let paths = RepoPaths::under(tmp.path());
        fs::create_dir_all(paths.root()).unwrap();
        fs::write(paths.config(), "{not json").unwrap();
        assert!(matches!(load_config(&paths), Err(SyncError::Backend(_))));
    }

    #[test]
    fn a_folder_in_the_files_place_is_an_io_error() {
        let tmp = TempDir::new().unwrap();
        let paths = RepoPaths::under(tmp.path());
        fs::create_dir_all(paths.config()).unwrap();
        assert!(matches!(load_config(&paths), Err(SyncError::Io(_))));
    }
}
