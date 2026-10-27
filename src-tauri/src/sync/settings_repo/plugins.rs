//! Plugin files of the settings repo, and the bookkeeping that tells a
//! plugin removed on another machine from one this machine has not synced.
//!
//! Each plugin has `plugins/<id>.json` with its source, version, enabled
//! state and settings; a core plugin's file carries only its settings. No
//! plugin code and no permission grant is ever written: each machine
//! installs and approves plugins itself.
//!
//! `state.json` remembers, per id, the install (`installedAt` from the
//! plugin's install marker) this machine last synced. A plugin installed
//! here that the repo lost is a removal made elsewhere only when it is that
//! same install; a new install, or one never synced, is written back.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::plugins::{is_well_formed_id, InstallSource};

use super::files::{Folder, SkipReason, SkippedFile};
use super::local::{LocalPlugin, Object};
use super::settings::{three_way, without_prototype_keys};

const CORE_PREFIX: &str = "glyph.core.";
/// Most plugin files an import reads.
pub(super) const MAX_PLUGIN_FILES: usize = 500;
const MAX_VERSION_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginSource {
    Marketplace,
    Local,
    Core,
    /// Installed before installs recorded where they came from.
    Unknown,
}

/// One plugin of the synced setup, for the Sync tab to install or list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedPlugin {
    pub id: String,
    pub source: PluginSource,
    pub version: String,
    pub enabled: bool,
}

/// The synced plugins, and the installed ones another machine removed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPlan {
    pub plugins: Vec<SyncedPlugin>,
    pub removals: Vec<String>,
}

/// Machine-local: the install of each plugin this machine last synced.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct SyncedInstalls {
    pub(super) synced: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Mode {
    /// A sync: keep what other machines added, and the removals they made.
    Merge,
    /// "Replace the synced setup": the repo ends up holding this machine's.
    Replace,
}

/// What an export does to `plugins/`.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Export {
    pub(super) writes: Vec<(String, Object)>,
    pub(super) removes: Vec<String>,
}

fn is_core(id: &str) -> bool {
    id.to_ascii_lowercase().starts_with(CORE_PREFIX)
}

/// The writes and removals that bring `plugins/` in line with this machine.
/// `head` is what the repo held before the sync.
pub(super) fn export(
    installed: &[LocalPlugin],
    disabled: &BTreeSet<String>,
    plugin_settings: &Object,
    head: &Pulled,
    state: &SyncedInstalls,
    mode: Mode,
) -> Export {
    let mut out = Export::default();
    let installed_ids: BTreeSet<&str> = installed.iter().map(|p| p.id.as_str()).collect();
    for plugin in installed {
        let Some(version) = &plugin.version else {
            continue;
        };
        let removed_elsewhere = mode == Mode::Merge
            && state.synced.get(&plugin.id) == Some(&plugin.installed_at())
            && !head.present.contains(&plugin.id);
        if !removed_elsewhere {
            let synced_settings = head.settings.get(&plugin.id);
            out.writes.push((
                plugin.id.clone(),
                entry(plugin, version, disabled, plugin_settings, synced_settings),
            ));
        }
    }
    for (id, value) in plugin_settings {
        let Value::Object(settings) = value else {
            continue;
        };
        if is_core(id) && is_well_formed_id(id) {
            out.writes.push((
                id.clone(),
                object(json!({"source": PluginSource::Core, "settings": settings})),
            ));
        }
    }
    let written: BTreeSet<&str> = out.writes.iter().map(|(id, _)| id.as_str()).collect();
    for id in &head.present {
        let uninstalled_here =
            !is_core(id) && !installed_ids.contains(id.as_str()) && state.synced.contains_key(id);
        let replaced = mode == Mode::Replace && !written.contains(id.as_str());
        if uninstalled_here || replaced {
            out.removes.push(id.clone());
        }
    }
    out
}

/// The installs a merge just took out although this machine never synced
/// them: a plugin installed, or installed again, here while another machine
/// removed it. Their files go back.
pub(super) fn restore(
    installed: &[LocalPlugin],
    disabled: &BTreeSet<String>,
    plugin_settings: &Object,
    present: &BTreeSet<String>,
    previous: &SyncedInstalls,
) -> Vec<(String, Object)> {
    installed
        .iter()
        .filter(|p| previous.synced.get(&p.id) != Some(&p.installed_at()))
        .filter(|p| !present.contains(&p.id))
        .filter_map(|p| {
            let version = p.version.as_deref()?;
            Some((
                p.id.clone(),
                entry(p, version, disabled, plugin_settings, None),
            ))
        })
        .collect()
}

/// A plugin's file. A plugin with no settings of its own here, one just
/// installed from the synced setup, carries the repo's `synced_settings`
/// rather than writing an empty map over them.
fn entry(
    plugin: &LocalPlugin,
    version: &str,
    disabled: &BTreeSet<String>,
    plugin_settings: &Object,
    synced_settings: Option<&Object>,
) -> Object {
    let source = match plugin.marker.map(|m| m.source) {
        Some(InstallSource::Marketplace) => PluginSource::Marketplace,
        Some(InstallSource::Local) => PluginSource::Local,
        None => PluginSource::Unknown,
    };
    let settings = match (plugin_settings.get(&plugin.id), synced_settings) {
        (Some(Value::Object(settings)), _) => Value::Object(settings.clone()),
        (_, Some(synced)) => Value::Object(synced.clone()),
        _ => json!({}),
    };
    object(json!({
        "source": source,
        "version": version,
        "enabled": !disabled.contains(&plugin.id),
        "settings": settings,
    }))
}

fn object(value: Value) -> Object {
    match value {
        Value::Object(map) => map,
        _ => Object::new(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    source: PluginSource,
    #[serde(default)]
    version: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    settings: Object,
}

fn enabled_by_default() -> bool {
    true
}

impl Entry {
    /// A core plugin's file says so, and no other plugin's does.
    fn fits(&self, id: &str) -> bool {
        let says_core = self.source == PluginSource::Core;
        let source_fits = if is_core(id) { says_core } else { !says_core };
        source_fits && self.version.len() <= MAX_VERSION_LEN
    }
}

/// The plugin files of a commit, checked: what each plugin is, and its
/// settings. An entry that is not one goes to `skipped`, but still counts
/// as `present`, so a damaged file never reads as a plugin removed.
#[derive(Debug, Default)]
pub(super) struct Pulled {
    pub(super) plugins: Vec<SyncedPlugin>,
    pub(super) settings: BTreeMap<String, Object>,
    pub(super) present: BTreeSet<String>,
    pub(super) skipped: Vec<SkippedFile>,
}

pub(super) fn parse(folder: Folder) -> Pulled {
    let mut pulled = Pulled {
        skipped: folder.skipped,
        present: folder.present,
        ..Pulled::default()
    };
    for (id, raw) in folder.files {
        let entry = serde_json::from_value::<Entry>(Value::Object(raw))
            .ok()
            .filter(|e| e.fits(&id));
        let Some(entry) = entry else {
            pulled.skipped.push(SkippedFile {
                path: format!("{}/{id}.json", super::files::PLUGINS_DIR),
                reason: SkipReason::BadEntry,
            });
            continue;
        };
        if entry.source != PluginSource::Core {
            pulled.plugins.push(SyncedPlugin {
                id: id.clone(),
                source: entry.source,
                version: entry.version,
                enabled: entry.enabled,
            });
        }
        pulled
            .settings
            .insert(id, without_prototype_keys(&entry.settings));
    }
    pulled
}

/// Plugin settings after a pull, three-way per plugin like settings, and
/// the ids whose settings changed. A plugin with no settings here exported
/// the repo's, so it counts as holding those.
pub(super) fn import_settings(
    store: &Object,
    base: &BTreeMap<String, Object>,
    merged: &BTreeMap<String, Object>,
) -> (Object, Vec<String>) {
    let mut next = store.clone();
    let mut changed = Vec::new();
    for (id, settings) in merged {
        let base_value = base.get(id).map(|b| Value::Object(b.clone()));
        let merged_value = Value::Object(settings.clone());
        let local = store.get(id).or(base_value.as_ref());
        let value = three_way(base_value.as_ref(), local, Some(&merged_value));
        if value.as_ref() != store.get(id) {
            if let Some(value) = value {
                next.insert(id.clone(), value);
                changed.push(id.clone());
            }
        }
    }
    (next, changed)
}

/// "Use the synced setup": each synced plugin's settings as the repo has
/// them. Settings of plugins the repo does not list stay.
pub(super) fn adopt_settings(
    store: &Object,
    merged: &BTreeMap<String, Object>,
) -> (Object, Vec<String>) {
    let mut next = store.clone();
    let mut changed = Vec::new();
    for (id, settings) in merged {
        let value = Value::Object(settings.clone());
        if store.get(id) != Some(&value) {
            next.insert(id.clone(), value);
            changed.push(id.clone());
        }
    }
    (next, changed)
}

/// What the Sync tab acts on: the synced plugins, and the installed ones the
/// repo no longer has a file for although this machine synced that very
/// install.
pub(super) fn plan(
    pulled: &Pulled,
    installed: &[LocalPlugin],
    state: &SyncedInstalls,
) -> PluginPlan {
    let removals = installed
        .iter()
        .filter(|p| state.synced.get(&p.id) == Some(&p.installed_at()))
        .filter(|p| !pulled.present.contains(&p.id))
        .map(|p| p.id.clone())
        .collect();
    PluginPlan {
        plugins: pulled.plugins.clone(),
        removals,
    }
}

/// The bookkeeping after a sync: `installed` as the export saw it, `in_repo`
/// the ids the repo now holds. An install the repo lost stays recorded, so
/// it stays a removal until it is uninstalled.
pub(super) fn after_sync(
    installed: &[LocalPlugin],
    in_repo: &BTreeSet<String>,
    previous: &SyncedInstalls,
) -> SyncedInstalls {
    let synced = installed
        .iter()
        .filter(|p| {
            in_repo.contains(&p.id) || previous.synced.get(&p.id) == Some(&p.installed_at())
        })
        .map(|p| (p.id.clone(), p.installed_at()))
        .collect();
    SyncedInstalls { synced }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plugins::InstallMarker;

    fn plugin(id: &str, installed_at: u64) -> LocalPlugin {
        LocalPlugin {
            id: id.into(),
            version: Some("1.0.0".into()),
            marker: Some(InstallMarker {
                source: InstallSource::Marketplace,
                installed_at,
            }),
        }
    }

    fn head(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn pulled(present: &[&str]) -> Pulled {
        Pulled {
            present: head(present),
            ..Pulled::default()
        }
    }

    fn synced(pairs: &[(&str, u64)]) -> SyncedInstalls {
        SyncedInstalls {
            synced: pairs.iter().map(|(id, at)| (id.to_string(), *at)).collect(),
        }
    }

    fn written(export: &Export) -> Vec<&str> {
        export.writes.iter().map(|(id, _)| id.as_str()).collect()
    }

    fn run(installed: &[LocalPlugin], head_ids: &[&str], state: &SyncedInstalls) -> Export {
        export(
            installed,
            &BTreeSet::new(),
            &Object::new(),
            &pulled(head_ids),
            state,
            Mode::Merge,
        )
    }

    #[test]
    fn a_first_sync_writes_every_installed_plugin() {
        let out = run(
            &[plugin("a.a", 1), plugin("b.b", 2)],
            &[],
            &SyncedInstalls::default(),
        );
        assert_eq!(written(&out), ["a.a", "b.b"]);
        assert!(out.removes.is_empty());
    }

    #[test]
    fn a_removal_made_elsewhere_is_not_written_back() {
        let out = run(&[plugin("a.a", 1)], &[], &synced(&[("a.a", 1)]));
        assert!(written(&out).is_empty());
        let plan = plan(&pulled(&[]), &[plugin("a.a", 1)], &synced(&[("a.a", 1)]));
        assert_eq!(plan.removals, ["a.a"]);
    }

    #[test]
    fn a_reinstall_after_a_removal_elsewhere_is_written_back() {
        let out = run(&[plugin("a.a", 2)], &[], &synced(&[("a.a", 1)]));
        assert_eq!(written(&out), ["a.a"]);
        assert!(
            plan(&pulled(&[]), &[plugin("a.a", 2)], &synced(&[("a.a", 1)]))
                .removals
                .is_empty()
        );
    }

    #[test]
    fn a_new_install_the_merge_took_out_is_restored_and_a_synced_one_is_not() {
        let installed = [
            plugin("new.new", 2),
            plugin("old.old", 1),
            plugin("kept.kept", 3),
        ];
        let present = head(&["kept.kept"]);
        let previous = synced(&[("new.new", 1), ("old.old", 1)]);
        let restored = restore(
            &installed,
            &BTreeSet::new(),
            &Object::new(),
            &present,
            &previous,
        );
        let ids: Vec<&str> = restored.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["new.new"]);
    }

    #[test]
    fn an_uninstall_here_removes_the_file() {
        let out = run(&[], &["a.a"], &synced(&[("a.a", 1)]));
        assert_eq!(out.removes, ["a.a"]);
    }

    #[test]
    fn a_plugin_never_installed_here_is_left_alone() {
        // Declined on this machine, or installed from a folder elsewhere.
        let out = run(&[], &["a.a"], &SyncedInstalls::default());
        assert!(out.writes.is_empty() && out.removes.is_empty());
    }

    #[test]
    fn replacing_writes_this_machine_and_removes_everything_else() {
        let out = export(
            &[plugin("a.a", 1)],
            &BTreeSet::new(),
            &Object::new(),
            &pulled(&["a.a", "b.b", "glyph.core.theme-presets"]),
            &synced(&[("a.a", 1)]),
            Mode::Replace,
        );
        assert_eq!(written(&out), ["a.a"]);
        assert_eq!(out.removes, ["b.b", "glyph.core.theme-presets"]);
    }

    #[test]
    fn an_entry_carries_source_version_enabled_state_and_settings_but_no_grants() {
        let mut settings = Object::new();
        settings.insert("a.a".into(), json!({"color": "red"}));
        settings.insert("glyph.core.theme-presets".into(), json!({"preset": "nord"}));
        settings.insert("../evil".into(), json!({}));
        let disabled: BTreeSet<String> = ["a.a".to_string()].into();
        let unmarked = LocalPlugin {
            marker: None,
            ..plugin("b.b", 0)
        };
        let out = export(
            &[plugin("a.a", 1), unmarked],
            &disabled,
            &settings,
            &Pulled::default(),
            &SyncedInstalls::default(),
            Mode::Merge,
        );
        let entries: BTreeMap<&str, Value> = out
            .writes
            .iter()
            .map(|(id, e)| (id.as_str(), Value::Object(e.clone())))
            .collect();
        assert_eq!(
            entries["a.a"],
            json!({"source": "marketplace", "version": "1.0.0", "enabled": false, "settings": {"color": "red"}})
        );
        assert_eq!(entries["b.b"]["source"], json!("unknown"));
        assert_eq!(
            entries["glyph.core.theme-presets"],
            json!({"source": "core", "settings": {"preset": "nord"}})
        );
        assert!(!entries.contains_key("../evil"));
        let text = serde_json::to_string(&entries).unwrap();
        assert!(!text.contains("grant") && !text.contains("fullTrust"));
    }

    #[test]
    fn a_folder_install_and_a_non_object_setting_are_told_apart() {
        let local = LocalPlugin {
            marker: Some(InstallMarker {
                source: InstallSource::Local,
                installed_at: 1,
            }),
            ..plugin("l.l", 1)
        };
        let mut settings = Object::new();
        settings.insert("glyph.core.x".into(), json!(5));
        let out = export(
            &[local],
            &BTreeSet::new(),
            &settings,
            &Pulled::default(),
            &SyncedInstalls::default(),
            Mode::Merge,
        );
        assert_eq!(written(&out), ["l.l"]);
        assert_eq!(out.writes[0].1["source"], json!("local"));
    }

    #[test]
    fn parsing_keeps_valid_entries_and_reports_the_rest() {
        let mut files = BTreeMap::new();
        files.insert(
            "a.a".to_string(),
            object(json!({"source": "marketplace", "version": "2.0.0"})),
        );
        files.insert("b.b".to_string(), object(json!({"source": "core"})));
        files.insert(
            "glyph.core.x".to_string(),
            object(json!({"source": "local"})),
        );
        files.insert("c.c".to_string(), object(json!({"source": "elsewhere"})));
        files.insert(
            "d.d".to_string(),
            object(json!({"source": "local", "version": "9".repeat(65)})),
        );
        files.insert(
            "glyph.core.theme-presets".to_string(),
            object(json!({"source": "core", "settings": {"preset": "nord", "__proto__": {}}})),
        );
        let present = files.keys().cloned().collect();
        let pulled = parse(Folder {
            files,
            present,
            skipped: Vec::new(),
        });
        assert_eq!(
            pulled.plugins,
            [SyncedPlugin {
                id: "a.a".into(),
                source: PluginSource::Marketplace,
                version: "2.0.0".into(),
                enabled: true
            }]
        );
        assert_eq!(
            pulled.settings.keys().collect::<Vec<_>>(),
            ["a.a", "glyph.core.theme-presets"]
        );
        assert_eq!(
            Value::Object(pulled.settings["glyph.core.theme-presets"].clone()),
            json!({"preset": "nord"})
        );
        let bad: Vec<&str> = pulled.skipped.iter().map(|s| s.path.as_str()).collect();
        assert_eq!(
            bad,
            [
                "plugins/b.b.json",
                "plugins/c.c.json",
                "plugins/d.d.json",
                "plugins/glyph.core.x.json"
            ]
        );
    }

    #[test]
    fn plugin_settings_land_three_way_and_report_what_changed() {
        let base: BTreeMap<String, Object> = [("a.a".to_string(), Object::new())].into();
        let mut merged = BTreeMap::new();
        merged.insert("a.a".to_string(), object(json!({"x": 2})));
        merged.insert("b.b".to_string(), object(json!({"y": 1})));
        let mut store = Object::new();
        store.insert("a.a".into(), json!({}));
        let (next, changed) = import_settings(&store, &base, &merged);
        assert_eq!(next["a.a"], json!({"x": 2}));
        assert_eq!(next["b.b"], json!({"y": 1}));
        assert_eq!(changed, ["a.a", "b.b"]);

        store.insert("a.a".into(), json!({"x": 5}));
        let (next, changed) = import_settings(&store, &base, &merged);
        assert_eq!(next["a.a"], json!({"x": 5}), "a local edit wins");
        assert_eq!(changed, ["b.b"]);
    }

    #[test]
    fn adopting_takes_the_repos_plugin_settings() {
        let mut merged = BTreeMap::new();
        merged.insert("a.a".to_string(), object(json!({"x": 2})));
        let mut store = Object::new();
        store.insert("a.a".into(), json!({"x": 1}));
        store.insert("z.z".into(), json!({"keep": true}));
        let (next, changed) = adopt_settings(&store, &merged);
        assert_eq!(next["a.a"], json!({"x": 2}));
        assert_eq!(next["z.z"], json!({"keep": true}));
        assert_eq!(changed, ["a.a"]);
        assert!(adopt_settings(&next, &merged).1.is_empty());
    }

    #[test]
    fn bookkeeping_keeps_synced_installs_and_pending_removals() {
        let installed = [plugin("a.a", 1), plugin("b.b", 2), plugin("c.c", 3)];
        let in_repo: BTreeSet<String> = ["a.a".to_string()].into();
        let previous = synced(&[("b.b", 2), ("c.c", 9)]);
        let next = after_sync(&installed, &in_repo, &previous);
        // a.a is in the repo; b.b is a pending removal; c.c is a new install
        // the repo has not seen yet.
        assert_eq!(next, synced(&[("a.a", 1), ("b.b", 2)]));
    }
}
