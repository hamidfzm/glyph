//! Connected tests of the settings repo: two machines syncing through one
//! bare remote, a remote that sends what it should not, and the IPC surface.

use std::fs;

use git2::{IndexEntry, IndexTime, Repository};
use serde_json::json;

use super::config::{load_config, save_config, Phase, RepoPaths};
use super::files::SkipReason;
use super::flow::{self, SettingsSyncOutcome, SetupChoice};
use super::test_support::{Cloud, Machine};
use crate::sync::git::{ConflictPick, ConflictSide};
use crate::sync::SyncError;

fn connect(cloud: &Cloud, name: &str, machine: &Machine) -> (RepoPaths, SettingsSyncOutcome) {
    let paths = cloud.paths(name);
    let outcome = flow::connect(&paths, machine, cloud.config(), None).unwrap();
    (paths, outcome)
}

/// Machine `name` connected to a cloud that already holds a setup, having
/// taken the synced one.
fn join(cloud: &Cloud, name: &str, machine: &Machine) -> RepoPaths {
    let (paths, outcome) = connect(cloud, name, machine);
    assert_eq!(outcome.phase, Phase::Choosing);
    flow::choose(&paths, machine, None, SetupChoice::UseSynced).unwrap();
    paths
}

fn run(paths: &RepoPaths, machine: &Machine) -> SettingsSyncOutcome {
    flow::run(paths, machine, None).unwrap()
}

/// Commit `files` (path, text, mode) straight onto the remote's branch, the
/// way another machine, or a hostile remote, would.
fn push_raw(cloud: &Cloud, files: &[(&str, &str, u32)]) {
    let repo = Repository::open(&cloud.remote).unwrap();
    let parent = repo
        .find_reference("refs/heads/main")
        .unwrap()
        .peel_to_commit()
        .unwrap();
    let mut index = git2::Index::new().unwrap();
    index.read_tree(&parent.tree().unwrap()).unwrap();
    for (path, text, mode) in files {
        index
            .add(&IndexEntry {
                ctime: IndexTime::new(0, 0),
                mtime: IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: *mode,
                uid: 0,
                gid: 0,
                file_size: text.len() as u32,
                id: repo.blob(text.as_bytes()).unwrap(),
                flags: 0,
                flags_extended: 0,
                path: path.as_bytes().to_vec(),
            })
            .unwrap();
    }
    let tree = repo.find_tree(index.write_tree_to(&repo).unwrap()).unwrap();
    let sig = git2::Signature::now("Elsewhere", "e@example.com").unwrap();
    repo.commit(
        Some("refs/heads/main"),
        &sig,
        &sig,
        "elsewhere",
        &tree,
        &[&parent],
    )
    .unwrap();
}

#[test]
fn connecting_to_an_empty_remote_uploads_this_machines_setup() {
    let cloud = Cloud::new();
    let machine = Machine::with_settings(json!({
        "appearance": {"theme": "dark"},
        "editor": {"keymap": "vim"}
    }));
    machine.install("com.x.plugin", 1);
    machine.set_plugin_setting("com.x.plugin", json!({"color": "red"}));

    let (paths, outcome) = connect(&cloud, "a", &machine);
    assert_eq!(outcome.phase, Phase::Active);
    assert!(outcome.result.unwrap().pushed_count >= 1);
    assert_eq!(load_config(&paths).unwrap().unwrap().phase, Phase::Active);
    assert!(cloud
        .file("settings/appearance.json")
        .unwrap()
        .contains("dark"));
    assert!(cloud.file("settings/editor.json").unwrap().contains("vim"));
    let entry = cloud.file("plugins/com.x.plugin.json").unwrap();
    assert!(
        entry.contains("marketplace") && entry.contains("red"),
        "{entry}"
    );
    assert!(machine.announced().is_empty(), "an upload lands nothing");
}

#[test]
fn nothing_that_never_syncs_reaches_the_remote() {
    let cloud = Cloud::new();
    let machine = Machine::with_settings(json!({
        "behavior": {
            "autoSave": true,
            "recentFiles": ["NS-recent"],
            "openTabs": [{"kind": "file", "path": "NS-tab"}],
            "activeTabPath": "NS-active",
            "defaultAppPrompt": "NS-prompt",
            "confirmExternalLinks": "NS-confirm",
            "checkForUpdates": "NS-updates"
        },
        "ai": {
            "model": "m",
            "apiKeys": {"claude": "NS-key"},
            "ollamaUrl": "NS-ollama",
            "agentWriteTools": {"NS-tool": true}
        },
        "privacy": {"errorReporting": "NS-privacy"}
    }));
    let (paths, _) = connect(&cloud, "a", &machine);
    machine.set_group("appearance", json!({"theme": "dark"}));
    run(&paths, &machine);

    let everything = cloud.every_blob();
    assert!(
        everything.contains("autoSave"),
        "the portable keys did sync"
    );
    assert!(!everything.contains("NS-"), "{everything}");
}

#[test]
fn a_remote_with_a_setup_waits_for_a_choice_and_changes_nothing() {
    let cloud = Cloud::new();
    connect(
        &cloud,
        "a",
        &Machine::with_settings(json!({"appearance": {"theme": "dark"}})),
    );

    let b = Machine::with_settings(json!({"appearance": {"theme": "light"}}));
    let before = b.settings_now();
    let (paths, outcome) = connect(&cloud, "b", &b);
    assert_eq!(outcome.phase, Phase::Choosing);
    assert!(outcome.result.is_none());
    assert_eq!(b.settings_now(), before);
    assert!(matches!(
        flow::run(&paths, &b, None),
        Err(SyncError::InvalidState(_))
    ));
    assert!(matches!(
        flow::status(&paths, None),
        Err(SyncError::InvalidState(_))
    ));
    assert_eq!(flow::plugin_plan(&paths, &b).unwrap(), Default::default());
    assert!(b.announced().is_empty());
}

#[test]
fn using_the_synced_setup_takes_its_settings_and_keeps_this_machines_plugins() {
    let cloud = Cloud::new();
    let a = Machine::with_settings(json!({
        "appearance": {"theme": "dark"},
        "behavior": {"recentFiles": ["A.md"]}
    }));
    a.install("x.x", 1);
    connect(&cloud, "a", &a);

    let b = Machine::with_settings(json!({
        "appearance": {"theme": "light", "fontSize": 20},
        "behavior": {"recentFiles": ["B.md"]}
    }));
    b.install("y.y", 7);
    let (paths, _) = connect(&cloud, "b", &b);
    let outcome = flow::choose(&paths, &b, None, SetupChoice::UseSynced).unwrap();

    let settings = b.settings_now();
    assert_eq!(settings["appearance"], json!({"theme": "dark"}));
    assert_eq!(settings["behavior"], json!({"recentFiles": ["B.md"]}));
    assert_eq!(b.announced().len(), 1);
    let ids: Vec<&str> = outcome
        .plugins
        .plugins
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    assert_eq!(ids, ["x.x"]);
    assert!(outcome.plugins.removals.is_empty());
    assert_eq!(load_config(&paths).unwrap().unwrap().phase, Phase::Active);

    // The plugin only B has joins the synced setup on its next sync.
    run(&paths, &b);
    assert!(cloud.file("plugins/y.y.json").is_some());
    assert!(cloud.file("plugins/x.x.json").is_some());
}

#[test]
fn replacing_the_synced_setup_keeps_the_remotes_history() {
    let cloud = Cloud::new();
    let a = Machine::with_settings(
        json!({"appearance": {"theme": "dark"}, "print": {"includeToc": true}}),
    );
    a.install("x.x", 1);
    connect(&cloud, "a", &a);
    let first = Repository::open(&cloud.remote)
        .unwrap()
        .refname_to_id("refs/heads/main")
        .unwrap();

    let b = Machine::with_settings(json!({"appearance": {"theme": "light"}}));
    b.install("y.y", 1);
    let (paths, _) = connect(&cloud, "b", &b);
    flow::choose(&paths, &b, None, SetupChoice::ReplaceSynced).unwrap();

    assert!(cloud
        .file("settings/appearance.json")
        .unwrap()
        .contains("light"));
    assert_eq!(cloud.file("settings/print.json"), None);
    assert_eq!(cloud.file("plugins/x.x.json"), None);
    assert!(cloud.file("plugins/y.y.json").is_some());
    let repo = Repository::open(&cloud.remote).unwrap();
    let head = repo.refname_to_id("refs/heads/main").unwrap();
    assert!(repo.graph_descendant_of(head, first).unwrap());
    assert_eq!(b.settings_now()["appearance"], json!({"theme": "light"}));
}

#[test]
fn a_change_made_on_one_machine_lands_on_the_other() {
    let cloud = Cloud::new();
    let a = Machine::with_settings(json!({"appearance": {"theme": "dark"}}));
    let (a_paths, _) = connect(&cloud, "a", &a);
    let b = Machine::default();
    let b_paths = join(&cloud, "b", &b);

    a.set_group("appearance", json!({"theme": "dark", "fontSize": 18}));
    a.set_plugin_setting("glyph.core.theme-presets", json!({"preset": "nord"}));
    run(&a_paths, &a);
    let outcome = run(&b_paths, &b);

    assert_eq!(b.settings_now()["appearance"]["fontSize"], json!(18));
    assert_eq!(
        b.plugin_settings_now()["glyph.core.theme-presets"],
        json!({"preset": "nord"})
    );
    assert_eq!(b.announced().last().unwrap(), &["glyph.core.theme-presets"]);
    assert!(outcome.result.unwrap().pulled_count >= 1);
    // Nothing changed this time, so no window hears about it.
    let heard = b.announced().len();
    run(&b_paths, &b);
    assert_eq!(b.announced().len(), heard);
}

#[test]
fn a_setting_changed_here_while_a_sync_runs_is_kept() {
    let cloud = Cloud::new();
    let a = Machine::with_settings(json!({"appearance": {"theme": "dark"}}));
    let (a_paths, _) = connect(&cloud, "a", &a);
    let b = Machine::default();
    let b_paths = join(&cloud, "b", &b);

    a.set_group("appearance", json!({"theme": "dark", "fontSize": 18}));
    run(&a_paths, &a);
    // The export reads settings first; the second read is after the pull.
    b.edit_on_read(2, "appearance", json!({"theme": "dark", "fontSize": 30}));
    run(&b_paths, &b);
    assert_eq!(b.settings_now()["appearance"]["fontSize"], json!(30));
}

/// A and B both change `appearance.theme`; B's sync stops on the conflict.
fn conflicted() -> (Cloud, Machine, RepoPaths) {
    let cloud = Cloud::new();
    let a = Machine::with_settings(json!({"appearance": {"theme": "dark"}}));
    let (a_paths, _) = connect(&cloud, "a", &a);
    let b = Machine::default();
    let b_paths = join(&cloud, "b", &b);
    a.set_group("appearance", json!({"theme": "A"}));
    run(&a_paths, &a);
    b.set_group("appearance", json!({"theme": "B"}));
    let outcome = run(&b_paths, &b);
    assert_eq!(outcome.conflicts, ["settings/appearance.json"]);
    (cloud, b, b_paths)
}

#[test]
fn a_conflict_stops_the_sync_until_a_side_is_picked() {
    let (_cloud, b, paths) = conflicted();
    assert_eq!(b.settings_now()["appearance"], json!({"theme": "B"}));
    let err = flow::run(&paths, &b, None).unwrap_err();
    assert!(matches!(err, SyncError::Conflict(_)), "{err:?}");
}

#[test]
fn taking_the_synced_side_keeps_what_changed_here_since_the_conflict() {
    let (cloud, b, paths) = conflicted();
    b.set_group("appearance", json!({"theme": "B", "fontSize": 25}));
    let picks = [ConflictPick {
        path: "settings/appearance.json".into(),
        side: ConflictSide::Remote,
    }];
    let outcome = flow::resolve(&paths, &b, None, &picks).unwrap();
    assert!(outcome.conflicts.is_empty());
    assert_eq!(
        b.settings_now()["appearance"],
        json!({"theme": "A", "fontSize": 25})
    );
    assert!(cloud
        .file("settings/appearance.json")
        .unwrap()
        .contains("\"A\""));
}

#[test]
fn keeping_this_machines_side_pushes_it() {
    let (cloud, b, paths) = conflicted();
    let picks = [ConflictPick {
        path: "settings/appearance.json".into(),
        side: ConflictSide::Local,
    }];
    flow::resolve(&paths, &b, None, &picks).unwrap();
    assert_eq!(b.settings_now()["appearance"], json!({"theme": "B"}));
    assert!(cloud
        .file("settings/appearance.json")
        .unwrap()
        .contains("\"B\""));
    assert!(run(&paths, &b).conflicts.is_empty());
}

#[test]
fn a_plugin_removed_elsewhere_is_offered_for_removal_and_never_written_back() {
    let cloud = Cloud::new();
    let a = Machine::default();
    a.install("p.p", 1);
    let (a_paths, _) = connect(&cloud, "a", &a);
    let b = Machine::default();
    b.install("p.p", 5);
    let b_paths = join(&cloud, "b", &b);

    a.uninstall("p.p");
    run(&a_paths, &a);
    assert_eq!(cloud.file("plugins/p.p.json"), None);

    assert_eq!(run(&b_paths, &b).plugins.removals, ["p.p"]);
    // Until the renderer removes it, a sync neither restores nor forgets it.
    assert_eq!(run(&b_paths, &b).plugins.removals, ["p.p"]);
    assert_eq!(cloud.file("plugins/p.p.json"), None);
    assert_eq!(flow::plugin_plan(&b_paths, &b).unwrap().removals, ["p.p"]);

    b.uninstall("p.p");
    assert!(run(&b_paths, &b).plugins.removals.is_empty());
    assert_eq!(cloud.file("plugins/p.p.json"), None);
}

#[test]
fn a_reinstall_after_a_removal_elsewhere_syncs_again() {
    let cloud = Cloud::new();
    let a = Machine::default();
    a.install("p.p", 1);
    let (a_paths, _) = connect(&cloud, "a", &a);
    let b = Machine::default();
    b.install("p.p", 5);
    let b_paths = join(&cloud, "b", &b);
    a.uninstall("p.p");
    run(&a_paths, &a);

    b.install("p.p", 6);
    assert!(run(&b_paths, &b).plugins.removals.is_empty());
    assert!(cloud.file("plugins/p.p.json").is_some());
}

#[test]
fn a_plugin_this_machine_never_installed_stays_in_the_synced_setup() {
    let cloud = Cloud::new();
    let a = Machine::default();
    a.install("q.q", 1);
    a.disable("q.q");
    connect(&cloud, "a", &a);
    let b = Machine::default();
    let b_paths = join(&cloud, "b", &b);

    let outcome = run(&b_paths, &b);
    assert!(cloud.file("plugins/q.q.json").is_some());
    let listed = &outcome.plugins.plugins;
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].enabled, "the enabled state travels");
    assert!(outcome.plugins.removals.is_empty());
}

#[test]
fn a_damaged_plugin_file_is_reported_and_never_read_as_a_removal() {
    let cloud = Cloud::new();
    let a = Machine::default();
    a.install("d.d", 1);
    connect(&cloud, "a", &a);
    let b = Machine::default();
    b.install("d.d", 2);
    let b_paths = join(&cloud, "b", &b);

    push_raw(&cloud, &[("plugins/d.d.json", "{nope", 0o100644)]);
    let outcome = run(&b_paths, &b);
    assert!(outcome.plugins.removals.is_empty());
    assert!(outcome
        .skipped
        .iter()
        .any(|s| s.path == "plugins/d.d.json" && s.reason == SkipReason::NotJson));
}

#[test]
fn a_hostile_remote_cannot_reach_what_never_syncs() {
    let cloud = Cloud::new();
    connect(
        &cloud,
        "a",
        &Machine::with_settings(json!({"appearance": {"theme": "dark"}})),
    );
    let b = Machine::default();
    let b_paths = join(&cloud, "b", &b);
    b.set_group(
        "behavior",
        json!({"recentFiles": ["C:/mine.md"], "checkForUpdates": true}),
    );
    b.set_group("ai", json!({"model": "mine"}));
    b.set_group("privacy", json!({"errorReporting": false}));
    run(&b_paths, &b);

    push_raw(
        &cloud,
        &[
            (
                "settings/behavior.json",
                r#"{"recentFiles":["\\\\evil\\share\\x.md"],"checkForUpdates":false,"autoSave":false}"#,
                0o100644,
            ),
            (
                "settings/privacy.json",
                r#"{"errorReporting":true}"#,
                0o100644,
            ),
            ("settings/ai.json", "../../../../outside", 0o120000),
        ],
    );
    let outcome = run(&b_paths, &b);

    let settings = b.settings_now();
    assert_eq!(settings["behavior"]["recentFiles"], json!(["C:/mine.md"]));
    assert_eq!(settings["behavior"]["checkForUpdates"], json!(true));
    assert_eq!(
        settings["behavior"]["autoSave"],
        json!(false),
        "portable keys do land"
    );
    assert_eq!(settings["privacy"], json!({"errorReporting": false}));
    assert_eq!(
        settings["ai"],
        json!({"model": "mine"}),
        "an unreadable file changes nothing"
    );
    let reasons: Vec<(&str, SkipReason)> = outcome
        .skipped
        .iter()
        .map(|s| (s.path.as_str(), s.reason))
        .collect();
    assert!(
        reasons.contains(&("settings/ai.json", SkipReason::NotAFile)),
        "{reasons:?}"
    );
    assert!(reasons.contains(&("settings/privacy.json", SkipReason::UnknownName)));
    // With links off, the checkout wrote the link as a plain file.
    let linked = b_paths.repo().join("settings/ai.json");
    assert!(fs::symlink_metadata(&linked).unwrap().is_file());
}

#[test]
fn disconnecting_forgets_the_remote_and_keeps_this_machines_setup() {
    let cloud = Cloud::new();
    let machine = Machine::with_settings(json!({"appearance": {"theme": "dark"}}));
    let (paths, _) = connect(&cloud, "a", &machine);
    flow::forget(&paths).unwrap();
    assert_eq!(load_config(&paths).unwrap(), None);
    assert!(!paths.root().exists());
    assert_eq!(
        machine.settings_now()["appearance"],
        json!({"theme": "dark"})
    );
    assert!(cloud.file("settings/appearance.json").is_some());
    flow::forget(&paths).unwrap();
}

#[test]
fn connecting_twice_is_refused_until_disconnected() {
    let cloud = Cloud::new();
    let machine = Machine::default();
    let (paths, _) = connect(&cloud, "a", &machine);
    let again = flow::connect(&paths, &machine, cloud.config(), None);
    assert!(matches!(again, Err(SyncError::InvalidState(_))));
    assert!(paths.repo().exists(), "the refusal keeps the connection");
}

#[test]
fn a_failed_connect_leaves_nothing_behind() {
    let cloud = Cloud::new();
    let paths = cloud.paths("a");
    let mut config = cloud.config();
    config.remote_url = cloud
        .tmp
        .path()
        .join("missing.git")
        .to_string_lossy()
        .into();
    assert!(flow::connect(&paths, &Machine::default(), config, None).is_err());
    assert!(!paths.root().exists());
}

#[test]
fn the_first_connect_choice_is_made_once() {
    let cloud = Cloud::new();
    let machine = Machine::default();
    let unconnected = cloud.paths("none");
    assert!(matches!(
        flow::choose(&unconnected, &machine, None, SetupChoice::UseSynced),
        Err(SyncError::NotConfigured)
    ));
    let (paths, _) = connect(&cloud, "a", &machine);
    assert!(matches!(
        flow::choose(&paths, &machine, None, SetupChoice::UseSynced),
        Err(SyncError::InvalidState(_))
    ));
}

#[test]
fn status_and_the_plan_read_the_repo_as_it_stands() {
    let cloud = Cloud::new();
    let machine = Machine::default();
    machine.install("z.z", 1);
    assert_eq!(
        flow::plugin_plan(&cloud.paths("a"), &machine).unwrap(),
        Default::default()
    );
    assert!(matches!(
        flow::status(&cloud.paths("a"), None),
        Err(SyncError::NotConfigured)
    ));
    let (paths, _) = connect(&cloud, "a", &machine);
    let status = flow::status(&paths, None).unwrap();
    assert!(status.clean && status.conflicts.is_empty(), "{status:?}");
    let plan = flow::plugin_plan(&paths, &machine).unwrap();
    assert_eq!(plan.plugins.len(), 1);
}

#[test]
fn resolving_with_nothing_to_resolve_is_refused() {
    let cloud = Cloud::new();
    let machine = Machine::default();
    let (paths, _) = connect(&cloud, "a", &machine);
    assert!(matches!(
        flow::resolve(&paths, &machine, None, &[]),
        Err(SyncError::InvalidState(_))
    ));
}

#[test]
fn a_repo_folder_gone_from_disk_reads_as_not_configured() {
    let cloud = Cloud::new();
    let machine = Machine::default();
    let (paths, _) = connect(&cloud, "a", &machine);
    fs::remove_dir_all(paths.repo()).unwrap();
    assert!(matches!(
        flow::run(&paths, &machine, None),
        Err(SyncError::NotConfigured)
    ));
    // A config left in the choosing phase does not sync either.
    let mut config = load_config(&paths).unwrap().unwrap();
    config.phase = Phase::Choosing;
    save_config(&paths, &config).unwrap();
    assert!(matches!(
        flow::resolve(&paths, &machine, None, &[]),
        Err(SyncError::InvalidState(_))
    ));
}

mod ipc {
    //! The command surface over real IPC, with the store plugin and every
    //! folder pointed into a temp dir.

    use std::path::Path;

    use serde_json::{json, Value};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::{Listener, Manager, WebviewWindowBuilder};
    use tauri_plugin_store::StoreExt;

    use super::super::commands::*;
    use super::super::config::{save_config, Phase, RepoPaths};
    use super::super::flow;
    use super::super::local::TauriLocal;
    use super::super::state::{Locations, SettingsSyncState};
    use super::super::test_support::Cloud;
    use super::push_raw;
    use crate::grants::GrantRegistry;

    type App = tauri::App<tauri::test::MockRuntime>;
    type Webview = tauri::WebviewWindow<tauri::test::MockRuntime>;

    fn build(locations: Locations) -> (App, Webview) {
        let app = mock_builder()
            .plugin(tauri_plugin_store::Builder::new().build())
            .invoke_handler(tauri::generate_handler![
                settings_sync_get_config,
                settings_sync_connect,
                settings_sync_set_token,
                settings_sync_has_token,
                settings_sync_clear_token,
                settings_sync_default_author,
                settings_sync_status,
                settings_sync_run,
                settings_sync_choose,
                settings_sync_resolve,
                settings_sync_plugin_plan,
                settings_sync_disconnect,
            ])
            .build(mock_context(noop_assets()))
            .expect("mock app builds");
        app.manage(SettingsSyncState::at(locations));
        app.manage(GrantRegistry::default());
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview builds");
        (app, webview)
    }

    fn call(webview: &Webview, cmd: &str, args: Value) -> Result<Value, Value> {
        let url = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: url.parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(webview, request).map(|body| body.deserialize().unwrap())
    }

    fn files_containing(dir: &Path, needle: &str) -> Vec<String> {
        let mut hits = Vec::new();
        for entry in walkdir(dir) {
            if std::fs::read(&entry)
                .map(|bytes| String::from_utf8_lossy(&bytes).contains(needle))
                .unwrap_or(false)
            {
                hits.push(entry.to_string_lossy().into_owned());
            }
        }
        hits
    }

    fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walkdir(&path));
            } else {
                out.push(path);
            }
        }
        out
    }

    #[test]
    fn every_command_round_trips_and_keeps_its_promises() {
        let _guard = crate::secrets::test_store::install();
        let cloud = Cloud::new();
        let base = cloud.tmp.path().join("machine");
        let locations = Locations {
            app_data: base.join("data"),
            settings_store: base.join("settings.json"),
            plugins_store: base.join("plugins.json"),
            plugins_root: base.join("plugins"),
        };
        let (app, webview) = build(locations.clone());
        app.state::<SettingsSyncState>().clear_token();

        let settings = app.store(&locations.settings_store).unwrap();
        settings.set(
            "settings",
            json!({"appearance": {"theme": "dark"}, "ai": {"apiKeys": {"claude": "NS-key"}}}),
        );
        let plugins = app.store(&locations.plugins_store).unwrap();
        plugins.set(
            "grants",
            json!({"x.x": {"permissions": ["NS-grant"], "fullTrust": true}}),
        );
        plugins.set("disabled", json!(["x.x"]));
        let plugin_dir = locations.plugins_root.join("com.x.demo");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("manifest.json"),
            r#"{"id":"com.x.demo","name":"Demo","version":"1.2.0","apiVersion":"^0.27.0"}"#,
        )
        .unwrap();
        std::fs::write(locations.plugins_root.join("stray.txt"), "").unwrap();
        std::fs::create_dir_all(locations.plugins_root.join("broken")).unwrap();

        assert_eq!(
            call(&webview, "settings_sync_get_config", json!({})),
            Ok(Value::Null)
        );
        assert_eq!(
            call(&webview, "settings_sync_has_token", json!({})),
            Ok(json!(false))
        );

        // Refused before anything is written: a local remote, and a token
        // for a remote that is not https.
        let refused = call(
            &webview,
            "settings_sync_connect",
            json!({"remoteUrl": cloud.remote.to_string_lossy(), "branch": "main", "author": null, "token": null}),
        );
        assert_eq!(refused.unwrap_err()["kind"], "invalid-remote-url");
        let refused = call(
            &webview,
            "settings_sync_connect",
            json!({"remoteUrl": "git@example.com:o/r.git", "branch": "main", "author": null, "token": "t"}),
        );
        assert_eq!(refused.unwrap_err()["kind"], "invalid-state");

        // A remote that cannot be reached: nothing is kept, the token neither.
        let unreachable = call(
            &webview,
            "settings_sync_connect",
            json!({"remoteUrl": "https://127.0.0.1:1/setup.git", "branch": "main", "author": null, "token": "NS-token"}),
        );
        assert!(unreachable.is_err());
        assert_eq!(
            call(&webview, "settings_sync_get_config", json!({})),
            Ok(Value::Null)
        );
        assert_eq!(
            call(&webview, "settings_sync_has_token", json!({})),
            Ok(json!(false))
        );

        // Connect to the local fixture remote below the IPC boundary, the
        // way a user's https or ssh remote ends up.
        let paths = RepoPaths::under(&locations.app_data);
        let local = TauriLocal::new(app.handle().clone(), locations.clone());
        flow::connect(&paths, &local, cloud.config(), None).unwrap();
        let entry = cloud.file("plugins/com.x.demo.json").unwrap();
        assert!(
            entry.contains("1.2.0") && entry.contains("unknown"),
            "{entry}"
        );

        let config = call(&webview, "settings_sync_get_config", json!({})).unwrap();
        assert_eq!(config["phase"], "active");
        let status = call(&webview, "settings_sync_status", json!({})).unwrap();
        assert_eq!(status["clean"], json!(true));
        let author = call(&webview, "settings_sync_default_author", json!({}));
        assert!(author.is_ok());
        assert!(call(&webview, "settings_sync_plugin_plan", json!({})).is_ok());
        assert_eq!(
            call(
                &webview,
                "settings_sync_choose",
                json!({"choice": "use-synced"})
            )
            .unwrap_err()["kind"],
            "invalid-state"
        );
        assert_eq!(
            call(&webview, "settings_sync_resolve", json!({"picks": []})).unwrap_err()["kind"],
            "invalid-state"
        );
        assert_eq!(
            call(&webview, "settings_sync_set_token", json!({"token": "t"})).unwrap_err()["kind"],
            "invalid-state",
            "a local remote takes no token"
        );

        // A change from elsewhere lands in the store and every window hears.
        push_raw(
            &cloud,
            &[("settings/appearance.json", r#"{"theme":"light"}"#, 0o100644)],
        );
        let heard = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = heard.clone();
        app.listen(super::super::SETTINGS_SYNCED_EVENT, move |event| {
            sink.lock().unwrap().push(event.payload().to_string());
        });
        let outcome = call(&webview, "settings_sync_run", json!({})).unwrap();
        assert_eq!(outcome["conflicts"], json!([]));
        assert_eq!(
            settings.get("settings").unwrap()["appearance"],
            json!({"theme": "light"})
        );
        assert_eq!(heard.lock().unwrap().len(), 1);
        assert!(!cloud.every_blob().contains("NS-"), "no grant, no key");

        call(&webview, "settings_sync_disconnect", json!({})).unwrap();
        assert_eq!(
            call(&webview, "settings_sync_get_config", json!({})),
            Ok(Value::Null)
        );
        assert!(!paths.root().exists());
        assert_eq!(
            settings.get("settings").unwrap()["appearance"],
            json!({"theme": "light"})
        );

        // A token for an https remote goes to the keychain and nowhere else.
        let mut https = cloud.config();
        https.remote_url = "https://127.0.0.1:1/setup.git".into();
        https.phase = Phase::Active;
        save_config(&paths, &https).unwrap();
        call(
            &webview,
            "settings_sync_set_token",
            json!({"token": "NS-token"}),
        )
        .unwrap();
        assert_eq!(
            call(&webview, "settings_sync_has_token", json!({})),
            Ok(json!(true))
        );
        assert!(call(&webview, "settings_sync_run", json!({})).is_err());
        assert!(files_containing(&base, "NS-token").is_empty());
        call(&webview, "settings_sync_clear_token", json!({})).unwrap();
        assert_eq!(
            call(&webview, "settings_sync_has_token", json!({})),
            Ok(json!(false))
        );
    }
}
