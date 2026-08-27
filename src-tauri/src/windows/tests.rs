//! Routing decisions and registry bookkeeping for [`super`]. These are pure,
//! so the whole open-request matrix is exercised without a window manager.

use super::*;

/// Build a snapshot from (label, workspace) pairs, with no files open.
fn ws(pairs: &[(&str, Option<&str>)]) -> WindowsSnapshot {
    WindowsSnapshot {
        workspaces: pairs
            .iter()
            .map(|(label, workspace)| (label.to_string(), workspace.map(str::to_string)))
            .collect(),
        files: Vec::new(),
    }
}

/// Build a snapshot from (label, open file paths) pairs, with no workspaces.
fn files(pairs: &[(&str, &[&str])]) -> WindowsSnapshot {
    WindowsSnapshot {
        workspaces: Vec::new(),
        files: pairs
            .iter()
            .map(|(label, paths)| {
                (
                    label.to_string(),
                    paths.iter().map(|p| p.to_string()).collect(),
                )
            })
            .collect(),
    }
}

fn pending(kind: OpenKind, path: &str) -> PendingOpen {
    PendingOpen {
        kind,
        path: path.to_string(),
    }
}

// --- files, default (current-window) routing ------------------------------

#[test]
fn file_opens_in_the_current_window_by_default() {
    let route = route_open(
        OpenKind::File,
        "/a/note.md",
        &ws(&[("main", None)]),
        "main",
        OpenTarget::Current,
    );
    assert_eq!(
        route,
        OpenRoute::Adopt("main".to_string(), pending(OpenKind::File, "/a/note.md"))
    );
}

#[test]
fn file_already_open_in_the_current_window_still_adopts() {
    // The frontend activates the existing tab rather than duplicating it, so
    // routing must not divert this to another window.
    let snapshot = files(&[("main", &["/a/note.md"])]);
    assert_eq!(
        route_open(
            OpenKind::File,
            "/a/note.md",
            &snapshot,
            "main",
            OpenTarget::Current
        ),
        OpenRoute::Adopt("main".to_string(), pending(OpenKind::File, "/a/note.md"))
    );
}

#[test]
fn file_open_in_another_window_focuses_that_window() {
    // A second instance launched with an already-open note focuses the window
    // that has it instead of duplicating the tab into the focused window.
    let snapshot = files(&[("main", &["/a/other.md"]), ("w1", &["/a/note.md"])]);
    assert_eq!(
        route_open(
            OpenKind::File,
            "/a/note.md",
            &snapshot,
            "main",
            OpenTarget::Current
        ),
        OpenRoute::Focus("w1".to_string())
    );
}

// --- files, explicit new-window routing -----------------------------------

#[test]
fn new_window_target_spawns_for_a_file_open_nowhere() {
    let route = route_open(
        OpenKind::File,
        "/a/note.md",
        &files(&[("main", &["/a/other.md"])]),
        "main",
        OpenTarget::NewWindow,
    );
    assert_eq!(
        route,
        OpenRoute::NewWindow(pending(OpenKind::File, "/a/note.md"))
    );
}

#[test]
fn new_window_target_spawns_for_a_file_open_in_the_current_window() {
    // "Open in new window" on the note you are reading moves it: the frontend
    // closes the source tab, so only the spawned window ends up showing it.
    let route = route_open(
        OpenKind::File,
        "/a/note.md",
        &files(&[("main", &["/a/note.md"])]),
        "main",
        OpenTarget::NewWindow,
    );
    assert_eq!(
        route,
        OpenRoute::NewWindow(pending(OpenKind::File, "/a/note.md"))
    );
}

#[test]
fn new_window_target_focuses_a_window_that_already_shows_the_file() {
    // Two windows editing one file means two autosave chains over one path.
    let snapshot = files(&[("main", &[]), ("w1", &["/a/note.md"])]);
    assert_eq!(
        route_open(
            OpenKind::File,
            "/a/note.md",
            &snapshot,
            "main",
            OpenTarget::NewWindow
        ),
        OpenRoute::Focus("w1".to_string())
    );
}

#[test]
fn duplicate_file_reports_resolve_deterministically() {
    // Two windows claiming one path is the transient the guard prevents; the
    // lowest label wins so repeated routing does not flip between them.
    let snapshot = files(&[("w2", &["/a/note.md"]), ("w1", &["/a/note.md"])]);
    assert_eq!(
        route_open(
            OpenKind::File,
            "/a/note.md",
            &snapshot,
            "main",
            OpenTarget::NewWindow
        ),
        OpenRoute::Focus("w1".to_string())
    );
}

// --- folders --------------------------------------------------------------

#[test]
fn folder_already_open_focuses_that_window() {
    let snapshot = ws(&[("main", Some("/a")), ("w1", Some("/b"))]);
    assert_eq!(
        route_open(
            OpenKind::Folder,
            "/b",
            &snapshot,
            "main",
            OpenTarget::Current
        ),
        OpenRoute::Focus("w1".to_string())
    );
}

#[test]
fn folder_in_an_empty_current_window_is_adopted() {
    let route = route_open(
        OpenKind::Folder,
        "/b",
        &ws(&[("main", None)]),
        "main",
        OpenTarget::Current,
    );
    assert_eq!(
        route,
        OpenRoute::Adopt("main".to_string(), pending(OpenKind::Folder, "/b"))
    );
}

#[test]
fn folder_with_an_occupied_current_window_spawns_a_new_window() {
    let route = route_open(
        OpenKind::Folder,
        "/b",
        &ws(&[("main", Some("/a"))]),
        "main",
        OpenTarget::Current,
    );
    assert_eq!(route, OpenRoute::NewWindow(pending(OpenKind::Folder, "/b")));
}

#[test]
fn current_window_absent_from_registry_counts_as_empty() {
    // A window that hasn't reported its workspace yet adopts rather than
    // spawning a redundant window.
    let route = route_open(
        OpenKind::Folder,
        "/b",
        &ws(&[("w1", Some("/a"))]),
        "main",
        OpenTarget::Current,
    );
    assert_eq!(
        route,
        OpenRoute::Adopt("main".to_string(), pending(OpenKind::Folder, "/b"))
    );
}

#[test]
fn focus_takes_priority_even_when_current_window_is_occupied() {
    let snapshot = ws(&[("main", Some("/a")), ("w1", Some("/b"))]);
    // Re-opening /a from main's occupied window focuses main, not a new one.
    assert_eq!(
        route_open(
            OpenKind::Folder,
            "/a",
            &snapshot,
            "main",
            OpenTarget::Current
        ),
        OpenRoute::Focus("main".to_string())
    );
}

#[test]
fn new_window_target_spawns_a_folder_even_from_an_empty_window() {
    // An explicit request beats the adopt-into-empty rule.
    let route = route_open(
        OpenKind::Folder,
        "/b",
        &ws(&[("main", None)]),
        "main",
        OpenTarget::NewWindow,
    );
    assert_eq!(route, OpenRoute::NewWindow(pending(OpenKind::Folder, "/b")));
}

#[test]
fn new_window_target_never_duplicates_a_workspace() {
    // Two windows on one root would race the sync git index and `.glyph` writes.
    let snapshot = ws(&[("main", None), ("w1", Some("/b"))]);
    assert_eq!(
        route_open(
            OpenKind::Folder,
            "/b",
            &snapshot,
            "main",
            OpenTarget::NewWindow
        ),
        OpenRoute::Focus("w1".to_string())
    );
}

// --- registry -------------------------------------------------------------

#[test]
fn registry_tracks_workspaces_and_files_together() {
    let registry = WindowRegistry::new();
    registry.set_workspace("main", Some("/a".to_string()));
    registry.set_workspace("w1", None);
    registry.set_files("w1", vec!["/a/note.md".to_string()]);

    let mut snapshot = registry.snapshot();
    snapshot.workspaces.sort();
    assert_eq!(
        snapshot.workspaces,
        vec![
            ("main".to_string(), Some("/a".to_string())),
            ("w1".to_string(), None),
        ]
    );
    assert_eq!(
        snapshot.files,
        vec![("w1".to_string(), vec!["/a/note.md".to_string()])]
    );
}

#[test]
fn remove_forgets_both_maps_for_a_closed_window() {
    let registry = WindowRegistry::new();
    registry.set_workspace("w1", Some("/a".to_string()));
    registry.set_files("w1", vec!["/a/note.md".to_string()]);
    registry.remove("w1");

    let snapshot = registry.snapshot();
    assert!(snapshot.workspaces.is_empty());
    assert!(snapshot.files.is_empty());
}

#[test]
fn add_file_registers_a_spawn_before_its_window_reports() {
    let registry = WindowRegistry::new();
    registry.add_file("w1", "/a/note.md".to_string());
    // Idempotent: a repeated pre-registration must not list the path twice.
    registry.add_file("w1", "/a/note.md".to_string());
    registry.add_file("w1", "/a/other.md".to_string());

    assert_eq!(
        registry.snapshot().files,
        vec![(
            "w1".to_string(),
            vec!["/a/note.md".to_string(), "/a/other.md".to_string()]
        )]
    );
}

#[test]
fn a_pre_registered_spawn_absorbs_a_repeated_request() {
    // The double-click case: the second route runs before the spawned window
    // has mounted, and must focus it rather than spawn a twin.
    let registry = WindowRegistry::new();
    let label = registry.next_label();
    registry.add_file(&label, "/a/note.md".to_string());

    assert_eq!(
        route_open(
            OpenKind::File,
            "/a/note.md",
            &registry.snapshot(),
            "main",
            OpenTarget::NewWindow,
        ),
        OpenRoute::Focus(label)
    );
}

#[test]
fn set_files_replaces_the_previous_report() {
    let registry = WindowRegistry::new();
    registry.set_files(
        "main",
        vec!["/a/one.md".to_string(), "/a/two.md".to_string()],
    );
    registry.set_files("main", vec!["/a/two.md".to_string()]);

    assert_eq!(
        registry.snapshot().files,
        vec![("main".to_string(), vec!["/a/two.md".to_string()])]
    );
}

#[test]
fn remove_file_drops_one_path_and_leaves_the_rest() {
    // The move path calls this on the window the note is leaving.
    let registry = WindowRegistry::new();
    registry.set_files(
        "main",
        vec!["/a/one.md".to_string(), "/a/two.md".to_string()],
    );
    registry.remove_file("main", "/a/one.md");

    assert_eq!(
        registry.snapshot().files,
        vec![("main".to_string(), vec!["/a/two.md".to_string()])]
    );
}

#[test]
fn remove_file_is_a_no_op_for_unknown_windows_and_paths() {
    let registry = WindowRegistry::new();
    registry.set_files("main", vec!["/a/one.md".to_string()]);
    registry.remove_file("main", "/a/never.md");
    registry.remove_file("w9", "/a/one.md");

    assert_eq!(
        registry.snapshot().files,
        vec![("main".to_string(), vec!["/a/one.md".to_string()])]
    );
}

#[test]
fn a_moved_note_is_not_still_claimed_by_the_window_it_left() {
    // Without remove_file the spawned window would ask "is this open
    // elsewhere", see the source window's stale entry, and bounce back to it.
    let registry = WindowRegistry::new();
    registry.set_files("main", vec!["/a/note.md".to_string()]);
    registry.remove_file("main", "/a/note.md");
    let label = registry.next_label();
    registry.add_file(&label, "/a/note.md".to_string());

    assert_eq!(
        registry.snapshot().window_with_file("/a/note.md", &label),
        None
    );
}

#[test]
fn window_with_file_finds_the_other_window_holding_a_path() {
    let registry = WindowRegistry::new();
    registry.set_files("main", vec!["/a/note.md".to_string()]);

    let snapshot = registry.snapshot();
    assert_eq!(snapshot.window_with_file("/a/note.md", "w1"), Some("main"));
    // Asking about your own tab is not "open elsewhere".
    assert_eq!(snapshot.window_with_file("/a/note.md", "main"), None);
    assert_eq!(snapshot.window_with_file("/a/other.md", "w1"), None);
}

#[test]
fn owned_paths_lists_a_window_s_files_and_its_workspace_root() {
    // This is the set of watches released when the window closes.
    let registry = WindowRegistry::new();
    registry.set_workspace("w1", Some("/a".to_string()));
    registry.set_files("w1", vec!["/a/note.md".to_string()]);

    assert_eq!(
        registry.owned_paths("w1"),
        vec!["/a/note.md".to_string(), "/a".to_string()]
    );
}

#[test]
fn owned_paths_skips_a_window_with_no_workspace() {
    let registry = WindowRegistry::new();
    registry.set_workspace("w1", None);
    registry.set_files("w1", vec!["/a/note.md".to_string()]);

    assert_eq!(registry.owned_paths("w1"), vec!["/a/note.md".to_string()]);
}

#[test]
fn owned_paths_is_empty_for_an_unknown_window() {
    assert!(WindowRegistry::new().owned_paths("w9").is_empty());
}

#[test]
fn next_label_is_unique_and_never_main() {
    let registry = WindowRegistry::new();
    let a = registry.next_label();
    let b = registry.next_label();
    assert_ne!(a, b);
    assert_ne!(a, "main");
    assert_ne!(b, "main");
}

#[test]
fn default_registry_is_empty() {
    let registry = WindowRegistry::default();
    assert_eq!(registry.snapshot(), WindowsSnapshot::default());
}
