//! This machine's side of a sync: the stores the renderer writes, the
//! installed plugins, and the event that tells every window an import
//! landed. A trait, so the flows run against an in-memory machine in tests.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_store::{Store, StoreExt};

use crate::commands::plugins::{inspect_dir, read_install_marker, InstallMarker};
use crate::sync::SyncError;

use super::state::Locations;
use super::SETTINGS_SYNCED_EVENT;

pub(super) type Object = Map<String, Value>;

/// The key the renderer keeps its settings under in the settings store.
const SETTINGS_KEY: &str = "settings";
/// Keys of the plugins store: per-plugin settings, and the disabled ids.
const PLUGIN_SETTINGS_KEY: &str = "settings";
const DISABLED_KEY: &str = "disabled";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LocalPlugin {
    pub(super) id: String,
    pub(super) version: String,
    /// `None` for a plugin installed before installs recorded their source.
    pub(super) marker: Option<InstallMarker>,
}

impl LocalPlugin {
    /// Which install of the id this is; a plugin without a marker counts as
    /// one unchanging install.
    pub(super) fn installed_at(&self) -> u64 {
        self.marker.map(|m| m.installed_at).unwrap_or(0)
    }
}

pub(super) trait LocalSetup {
    fn settings(&self) -> Result<Object, SyncError>;
    fn set_settings(&self, settings: Object) -> Result<(), SyncError>;
    fn plugin_settings(&self) -> Result<Object, SyncError>;
    fn set_plugin_settings(&self, settings: Object) -> Result<(), SyncError>;
    fn disabled_plugins(&self) -> Result<BTreeSet<String>, SyncError>;
    fn installed_plugins(&self) -> Vec<LocalPlugin>;
    /// Tell every window that an import rewrote settings on disk.
    fn announce(&self, plugin_ids: Vec<String>);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SettingsSynced {
    plugin_ids: Vec<String>,
}

/// The real machine: the stores the app opened at startup, through the
/// store plugin, so a write here is the same in-memory store each window
/// reads, and the plugins folder.
pub(super) struct TauriLocal<R: Runtime> {
    app: AppHandle<R>,
    locations: Locations,
}

impl<R: Runtime> TauriLocal<R> {
    pub(super) fn new(app: AppHandle<R>, locations: Locations) -> Self {
        Self { app, locations }
    }

    fn store(&self, file: &Path) -> Result<Arc<Store<R>>, SyncError> {
        self.app
            .store(file)
            .map_err(|e| SyncError::Backend(e.to_string()))
    }

    fn object(&self, file: &Path, key: &str) -> Result<Object, SyncError> {
        Ok(match self.store(file)?.get(key) {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        })
    }

    fn set_object(&self, file: &Path, key: &str, value: Object) -> Result<(), SyncError> {
        let store = self.store(file)?;
        store.set(key, Value::Object(value));
        store.save().map_err(|e| SyncError::Backend(e.to_string()))
    }
}

impl<R: Runtime> LocalSetup for TauriLocal<R> {
    fn settings(&self) -> Result<Object, SyncError> {
        self.object(&self.locations.settings_store, SETTINGS_KEY)
    }

    fn set_settings(&self, settings: Object) -> Result<(), SyncError> {
        self.set_object(&self.locations.settings_store, SETTINGS_KEY, settings)
    }

    fn plugin_settings(&self) -> Result<Object, SyncError> {
        self.object(&self.locations.plugins_store, PLUGIN_SETTINGS_KEY)
    }

    fn set_plugin_settings(&self, settings: Object) -> Result<(), SyncError> {
        self.set_object(&self.locations.plugins_store, PLUGIN_SETTINGS_KEY, settings)
    }

    fn disabled_plugins(&self) -> Result<BTreeSet<String>, SyncError> {
        let store = self.store(&self.locations.plugins_store)?;
        Ok(match store.get(DISABLED_KEY) {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => BTreeSet::new(),
        })
    }

    /// Manifests only: a sync needs ids and versions, not the entry sources.
    fn installed_plugins(&self) -> Vec<LocalPlugin> {
        let Ok(entries) = std::fs::read_dir(&self.locations.plugins_root) else {
            return Vec::new();
        };
        let mut plugins: Vec<LocalPlugin> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|dir| dir.is_dir())
            .filter_map(|dir| {
                let manifest = inspect_dir(&dir).ok()?;
                Some(LocalPlugin {
                    id: manifest.id,
                    version: manifest.version,
                    marker: read_install_marker(&dir),
                })
            })
            .collect();
        plugins.sort_by(|a, b| a.id.cmp(&b.id));
        plugins
    }

    fn announce(&self, plugin_ids: Vec<String>) {
        if let Err(e) = self
            .app
            .emit(SETTINGS_SYNCED_EVENT, SettingsSynced { plugin_ids })
        {
            eprintln!("settings sync: failed to announce the import: {e}");
        }
    }
}
