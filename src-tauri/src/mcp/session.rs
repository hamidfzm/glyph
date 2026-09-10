//! What the user has open, read from the stores the app persists: the
//! workspace pointer and loose files in `settings.json`, and each workspace's
//! own tabs in `workspace-sessions.json` under its root. The renderer writes
//! both, so every field is optional and anything malformed is skipped.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::data_dir;
use crate::grants::GrantRegistry;

#[derive(Debug, Default)]
pub struct OpenState {
    /// The vault roots the tools may read.
    pub roots: Vec<String>,
    pub app_running: bool,
    pub active_note: Option<String>,
    pub tabs: Vec<OpenTab>,
    /// Folders expanded in each vault's file tree, by root.
    pub expanded: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct OpenTab {
    /// `file` or `graph`.
    pub kind: String,
    pub path: String,
}

/// The state a stdio call sees. Roots come from `--vault` when it was given,
/// otherwise from the app's session, re-read every call so a vault opened
/// mid-conversation appears.
pub(super) fn open_state(cli_vaults: &[String], grants: &GrantRegistry) -> OpenState {
    let settings = data_dir::read_store("settings.json");
    let sessions = data_dir::read_store("workspace-sessions.json");
    observed(
        cli_vaults,
        grants,
        settings.as_deref(),
        sessions.as_deref(),
        data_dir::app_running(),
    )
}

/// [`open_state`] over store contents already read.
fn observed(
    cli_vaults: &[String],
    grants: &GrantRegistry,
    settings: Option<&str>,
    sessions: Option<&str>,
    app_running: bool,
) -> OpenState {
    if cli_vaults.is_empty() {
        if let Some(raw) = settings {
            // The trust the app's own startup seed already gives this file.
            grants.seed_from_settings_json(raw);
        }
    }
    admitted(parse(settings, sessions), cli_vaults, app_running, grants)
}

/// What the stores say, before anything is checked.
fn parse(settings: Option<&str>, sessions: Option<&str>) -> OpenState {
    let settings: Value = settings
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    let sessions: Value = sessions
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    let behavior = &settings["settings"]["behavior"];

    let mut state = OpenState::default();
    for tab in behavior["openTabs"].as_array().into_iter().flatten() {
        let (Some(kind), Some(path)) = (tab["kind"].as_str(), tab["path"].as_str()) else {
            continue;
        };
        match kind {
            // A workspace tab carries its root; its own tabs are in its session.
            "folder" | "graph" if !state.roots.iter().any(|root| root == path) => {
                state.roots.push(path.to_string());
            }
            "file" => state.tabs.push(OpenTab {
                kind: kind.to_string(),
                path: path.to_string(),
            }),
            _ => {}
        }
    }

    let active = behavior["activeTabPath"].as_str().unwrap_or_default();
    for root in &state.roots {
        let session = &sessions[root.as_str()];
        for tab in session["tabs"].as_array().into_iter().flatten() {
            if let (Some(kind @ ("file" | "graph")), Some(path)) =
                (tab["kind"].as_str(), tab["path"].as_str())
            {
                state.tabs.push(OpenTab {
                    kind: kind.to_string(),
                    path: path.to_string(),
                });
            }
        }
        let expanded = session["expanded"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        state.expanded.insert(root.clone(), expanded);
        if root == active {
            state.active_note = session["activeTabPath"]
                .as_str()
                .filter(|path| !path.is_empty())
                .map(str::to_string);
        }
    }
    let active_is_a_file = !active.is_empty() && !state.roots.iter().any(|root| root == active);
    if active_is_a_file {
        state.active_note = Some(active.to_string());
    }
    state
}

/// `--vault` roots replace the session's, a closed app has nothing open, and
/// nothing is reported that the grants would refuse to read.
fn admitted(
    mut state: OpenState,
    cli_vaults: &[String],
    app_running: bool,
    grants: &GrantRegistry,
) -> OpenState {
    if cli_vaults.is_empty() {
        state
            .roots
            .retain(|root| grants.ensure_workspace(root).is_ok());
    } else {
        // Granted at startup, so one deleted since stays listed and every
        // tool can say it is gone.
        state.roots = cli_vaults.to_vec();
    }
    state.app_running = app_running;
    if !app_running {
        state.active_note = None;
        state.tabs.clear();
        state.expanded.clear();
        return state;
    }
    state
        .tabs
        .retain(|tab| grants.ensure_readable(&tab.path).is_ok());
    state.active_note = state
        .active_note
        .filter(|path| grants.ensure_readable(path).is_ok());
    state
        .expanded
        .retain(|root, _| grants.ensure_workspace(root).is_ok());
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    fn spelled(path: &std::path::Path) -> String {
        path.to_string_lossy().to_string()
    }

    /// A workspace with two notes, a loose note beside it, and the two
    /// stores describing a session over them.
    fn fixture() -> (TempDir, String, String, String, String) {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("a.md"), "a").unwrap();
        fs::write(ws.join("b.md"), "b").unwrap();
        fs::write(tmp.path().join("loose.md"), "loose").unwrap();
        let (root, a, b, loose) = (
            spelled(&ws),
            spelled(&ws.join("a.md")),
            spelled(&ws.join("b.md")),
            spelled(&tmp.path().join("loose.md")),
        );
        (tmp, root, a, b, loose)
    }

    fn stores(root: &str, a: &str, b: &str, loose: &str) -> (String, String) {
        let settings = json!({
            "settings": { "behavior": {
                "openTabs": [
                    { "kind": "folder", "path": root },
                    { "kind": "file", "path": loose },
                    { "kind": "graph", "path": root },
                    { "kind": "hologram", "path": loose },
                    { "path": a },
                ],
                "activeTabPath": root,
            } }
        });
        let sessions = json!({
            root: {
                "tabs": [
                    { "kind": "file", "path": a },
                    { "kind": "graph", "path": root },
                    { "kind": "file" },
                    { "kind": "folder", "path": b },
                ],
                "activeTabPath": a,
                "expanded": [spelled(std::path::Path::new(root).join("sub").as_path()), 7],
            },
            "/some/closed/workspace": { "tabs": [{ "kind": "file", "path": "/x.md" }] },
        });
        (settings.to_string(), sessions.to_string())
    }

    #[test]
    fn the_stores_describe_the_workspace_its_tabs_and_the_active_note() {
        let (_tmp, root, a, b, loose) = fixture();
        let (settings, sessions) = stores(&root, &a, &b, &loose);
        let state = parse(Some(&settings), Some(&sessions));

        // Two tabs point at one workspace; it is one root.
        assert_eq!(state.roots, std::slice::from_ref(&root));
        // The workspace is the active tab, so its own active note is the one.
        assert_eq!(state.active_note.as_deref(), Some(a.as_str()));
        let tabs: Vec<(&str, &str)> = state
            .tabs
            .iter()
            .map(|tab| (tab.kind.as_str(), tab.path.as_str()))
            .collect();
        assert_eq!(
            tabs,
            [
                ("file", loose.as_str()),
                ("file", a.as_str()),
                ("graph", root.as_str())
            ]
        );
        assert_eq!(state.expanded[&root].len(), 1);
    }

    #[test]
    fn a_loose_file_can_be_the_active_note() {
        let settings = json!({ "settings": { "behavior": {
            "openTabs": [{ "kind": "file", "path": "/n.md" }],
            "activeTabPath": "/n.md",
        } } })
        .to_string();
        let state = parse(Some(&settings), None);
        assert_eq!(state.active_note.as_deref(), Some("/n.md"));
        assert!(state.roots.is_empty());
    }

    #[test]
    fn missing_and_corrupt_stores_mean_nothing_is_open() {
        for (settings, sessions) in [
            (None, None),
            (Some("not json"), Some("{")),
            (Some("{}"), Some("[]")),
            (
                Some(r#"{"settings":{"behavior":{"openTabs":"nope"}}}"#),
                None,
            ),
        ] {
            let state = parse(settings, sessions);
            assert!(state.roots.is_empty() && state.tabs.is_empty());
            assert_eq!(state.active_note, None);
        }
    }

    #[test]
    fn a_closed_app_keeps_its_roots_but_has_nothing_open() {
        let (_tmp, root, a, b, loose) = fixture();
        let (settings, sessions) = stores(&root, &a, &b, &loose);
        // With no --vault, the settings seed the grants the way the app's
        // startup does, so the session's workspace is a root.
        let grants = GrantRegistry::default();
        let state = observed(&[], &grants, Some(&settings), Some(&sessions), false);
        assert_eq!(state.roots, [root]);
        assert!(!state.app_running);
        assert_eq!(state.active_note, None);
        assert!(state.tabs.is_empty() && state.expanded.is_empty());
    }

    #[test]
    fn a_vault_flag_hides_everything_outside_it() {
        let (_tmp, root, a, b, loose) = fixture();
        let (settings, sessions) = stores(&root, &a, &b, &loose);
        let other = TempDir::new().unwrap();
        let other_root = spelled(other.path());
        let grants = GrantRegistry::default();
        grants.grant_workspace(other.path()).unwrap();

        let state = admitted(
            parse(Some(&settings), Some(&sessions)),
            std::slice::from_ref(&other_root),
            true,
            &grants,
        );
        assert_eq!(state.roots, [other_root]);
        // The app's tabs and active note are in a vault this server was not
        // given, so not even their paths are reported.
        assert!(state.tabs.is_empty());
        assert_eq!(state.active_note, None);
        assert!(state.expanded.is_empty());
    }

    #[test]
    fn a_vault_flag_root_stays_listed_after_it_is_deleted() {
        let gone = TempDir::new().unwrap();
        let root = spelled(gone.path());
        let grants = GrantRegistry::default();
        grants.grant_workspace(gone.path()).unwrap();
        drop(gone);

        let state = admitted(
            OpenState::default(),
            std::slice::from_ref(&root),
            false,
            &grants,
        );
        assert_eq!(state.roots, [root]);
    }

    #[test]
    fn a_running_app_reports_only_what_the_grants_admit() {
        let (_tmp, root, a, b, loose) = fixture();
        let (settings, sessions) = stores(&root, &a, &b, &loose);
        // The workspace is granted; the loose file beside it is not.
        let grants = GrantRegistry::default();
        grants.grant_workspace(std::path::Path::new(&root)).unwrap();

        let state = admitted(parse(Some(&settings), Some(&sessions)), &[], true, &grants);
        assert!(state.app_running);
        assert_eq!(state.active_note.as_deref(), Some(a.as_str()));
        assert!(state.tabs.iter().all(|tab| tab.path != loose));
        assert_eq!(state.tabs.len(), 2);
        assert_eq!(state.expanded.len(), 1);
    }
}
