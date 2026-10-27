use notify::event::{ModifyKind, RemoveKind};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::commands::walk::WALK_SKIP_DIRS;
use crate::grants::GrantRegistry;
use crate::vault::VaultStore;

pub struct FileWatcherState(pub Arc<Mutex<HashMap<String, RecommendedWatcher>>>);

/// What a change inside a watched workspace leaves out of date, weakest first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum DirectoryChange {
    /// Only the file tree: an entry holding no documents came, went, or was
    /// renamed (an image, a plugin's file type, anything under `node_modules`).
    Listing,
    /// The documents too, so the index and the document list are read again.
    Documents,
}

/// The `directory-changed` payload, with the root as the window spelled it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryChangedPayload<'a> {
    root: &'a str,
    documents_changed: bool,
}

/// What `event` leaves out of date for the workspace at `root`, or `None`
/// when nothing the window shows changed. The tree lists every visible entry
/// whatever its type, so any of them coming, going, or being renamed counts;
/// only the index reads content, so an edit counts for indexed notes alone.
fn directory_change(event: &Event, root: &Path) -> Option<DirectoryChange> {
    let came_or_went = match event.kind {
        EventKind::Create(_) | EventKind::Remove(_) => true,
        EventKind::Modify(ModifyKind::Name(_)) => true,
        EventKind::Modify(_) => false,
        _ => return None,
    };
    event
        .paths
        .iter()
        .filter_map(|path| {
            let relative = visible_below(path, root)?;
            let documents_here = !is_skipped(relative);
            if came_or_went && documents_here {
                Some(entry_change(path, event.kind))
            } else if came_or_went {
                Some(DirectoryChange::Listing)
            } else if documents_here
                && (crate::is_markdown_file(path) || crate::is_canvas_file(path))
            {
                Some(DirectoryChange::Documents)
            } else {
                None
            }
        })
        .max()
}

/// `path` below `root`, or `None` for the root itself and for an entry the
/// tree hides: a name below the root starting with `.`, the rule
/// `read_directory` applies at each level. Only the part below the root is
/// judged, since a workspace may live in a hidden folder (`~/.config/notes`).
fn visible_below<'a>(path: &'a Path, root: &Path) -> Option<&'a Path> {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let hidden = relative
        .components()
        .any(|part| part.as_os_str().to_string_lossy().starts_with('.'));
    let is_root = relative.as_os_str().is_empty();
    (!hidden && !is_root).then_some(relative)
}

/// Whether `relative` lies in a folder the document list and the index never
/// walk into, though the tree lists it.
fn is_skipped(relative: &Path) -> bool {
    relative.components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        WALK_SKIP_DIRS.contains(&name.as_ref())
    })
}

/// What an entry that came, went, or was renamed leaves out of date. A folder
/// may hold documents, and one that is gone may have. `symlink_metadata` keeps
/// the lookup off any link.
fn entry_change(path: &Path, kind: EventKind) -> DirectoryChange {
    if crate::is_supported_file(path) {
        return DirectoryChange::Documents;
    }
    // Where the backend says what went (inotify, FSEvents), a file held none.
    if kind == EventKind::Remove(RemoveKind::File) {
        return DirectoryChange::Listing;
    }
    match std::fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() => DirectoryChange::Listing,
        _ => DirectoryChange::Documents,
    }
}

/// A file watch should fire when the watched file's content changes. Editors
/// commonly save by replacing the file, so creations count as changes too.
/// Extracted as a pure helper so the filter is testable without a live watcher.
pub fn is_relevant_file_change(event: &Event) -> bool {
    matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_))
}

/// Body of the file watch's callback: drop watcher errors, and emit for a
/// relevant change. Extracted so the error and filtered-out arms are testable:
/// a live watcher only delivers them on hard-to-reproduce filesystem conditions.
fn forward_file_event(res: Result<Event, notify::Error>, emit: impl FnOnce()) {
    if res.is_ok_and(|event| is_relevant_file_change(&event)) {
        emit();
    }
}

/// Body of the directory watch's callback. Only a document change re-indexes,
/// and before the window hears of it, so the snapshot it asks for next is
/// already current.
fn forward_directory_event(
    res: Result<Event, notify::Error>,
    root: &Path,
    reindex: impl FnOnce(&[PathBuf]),
    emit: impl FnOnce(DirectoryChange),
) {
    let Ok(event) = res else {
        return;
    };
    let Some(change) = directory_change(&event, root) else {
        return;
    };
    if change == DirectoryChange::Documents {
        reindex(&event.paths);
    }
    emit(change);
}

/// A watcher that stays inside the folder it is given. By default `notify`
/// follows symbolic links when it registers a recursive watch, so a workspace
/// holding a link to `/` or to the home folder would put a watch on every
/// directory under it, exhaust the user's watch quota, and re-index on every
/// change there. The index never follows a link either.
fn new_watcher<F>(handler: F) -> Result<RecommendedWatcher, String>
where
    F: Fn(Result<Event, notify::Error>) + Send + 'static,
{
    RecommendedWatcher::new(handler, Config::default().with_follow_symlinks(false))
        .map_err(|e| format!("Failed to create watcher: {e}"))
}

fn watchers(
    state: &FileWatcherState,
) -> Result<MutexGuard<'_, HashMap<String, RecommendedWatcher>>, String> {
    state.0.lock().map_err(|e| format!("Lock error: {e}"))
}

/// Register `watcher` under `path` once it is watching. Two calls for the
/// same path can get this far together; the first one in keeps its watcher
/// and the other is dropped, which releases its watches.
fn register(
    state: &FileWatcherState,
    path: String,
    watcher: RecommendedWatcher,
) -> Result<(), String> {
    watchers(state)?.entry(path).or_insert(watcher);
    Ok(())
}

/// Release the watches a closing window owned. Nothing else unwatches them:
/// the frontend's `unwatch_*` calls fire on tab and workspace close, not on
/// window teardown, so without this every path a window opened keeps a live
/// `notify` watcher for the rest of the session.
pub fn drop_watches<R: Runtime>(app: &AppHandle<R>, paths: &[String]) {
    let Some(state) = app.try_state::<FileWatcherState>() else {
        return;
    };
    let Ok(mut watchers) = state.0.lock() else {
        return;
    };
    for path in paths {
        watchers.remove(path);
    }
}

#[tauri::command]
pub fn watch_file<R: Runtime>(
    path: String,
    app: AppHandle<R>,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    // Watch the canonical path, but key the map and emit events in the
    // frontend's own path spelling so they keep matching its tab paths.
    let canonical = grants.ensure_watchable(&path)?;
    let state = app.state::<FileWatcherState>();
    if watchers(&state)?.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    let mut watcher = new_watcher(move |res| {
        forward_file_event(res, || {
            let _ = app_handle.emit("file-changed", &watched_path);
        });
    })?;
    watcher
        .watch(&canonical, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {e}"))?;
    register(&state, path, watcher)
}

#[tauri::command]
pub fn unwatch_file<R: Runtime>(path: String, app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    watchers.remove(&path);
    Ok(())
}

#[tauri::command]
pub fn watch_directory<R: Runtime>(
    path: String,
    app: AppHandle<R>,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    let canonical = grants.ensure_watchable(&path)?;
    let state = app.state::<FileWatcherState>();
    if watchers(&state)?.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    // Events arrive spelled against the path being watched, not the window's.
    let root = canonical.clone();
    let mut watcher = new_watcher(move |res| {
        forward_directory_event(
            res,
            &root,
            |paths| {
                if let Some(store) = app_handle.try_state::<VaultStore>() {
                    crate::vault::apply_changes(&store, &watched_path, paths);
                }
            },
            |change| {
                let payload = DirectoryChangedPayload {
                    root: &watched_path,
                    documents_changed: change == DirectoryChange::Documents,
                };
                let _ = app_handle.emit("directory-changed", payload);
            },
        );
    })?;
    // A recursive watch walks the whole tree to register it, and the lock is
    // not held meanwhile: every other watch and unwatch call would wait.
    watcher
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;
    register(&state, path, watcher)
}

#[tauri::command]
pub fn unwatch_directory<R: Runtime>(path: String, app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    watchers.remove(&path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::test::{mock_app, MockRuntime};
    use tauri::{App, Listener};

    fn event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    /// A mock Tauri app with an empty [`FileWatcherState`] managed, so the
    /// `watch_*` / `unwatch_*` commands resolve `app.state::<FileWatcherState>()`
    /// without booting a real window manager.
    fn mock_app_with_state() -> App<MockRuntime> {
        let app = mock_app();
        app.manage(FileWatcherState(Arc::new(Mutex::new(HashMap::new()))));
        app.manage(GrantRegistry::default());
        // The directory watcher re-indexes through the store before it emits.
        app.manage(VaultStore::default());
        app
    }

    fn grant_dir(app: &App<MockRuntime>, dir: &std::path::Path) {
        app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
    }

    /// Number of paths currently registered in the watcher state map.
    fn watched_count(app: &App<MockRuntime>) -> usize {
        app.state::<FileWatcherState>().0.lock().unwrap().len()
    }

    fn is_watched(app: &App<MockRuntime>, path: &str) -> bool {
        app.state::<FileWatcherState>()
            .0
            .lock()
            .unwrap()
            .contains_key(path)
    }

    /// Create a unique temp directory for a test, returning its path.
    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_watcher_test_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Subscribe to `event` on the app handle, returning the payloads it
    /// carries, in the order it fires.
    fn record_event(
        app: &App<MockRuntime>,
        event: &'static str,
    ) -> Arc<Mutex<Vec<serde_json::Value>>> {
        let payloads = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&payloads);
        app.handle().listen(event, move |fired| {
            let payload = serde_json::from_str(fired.payload()).unwrap();
            sink.lock().unwrap().push(payload);
        });
        payloads
    }

    /// Poll `payloads` until one arrives or `timeout` elapses. Returns the
    /// final count. Filesystem-notification latency varies by platform, so the
    /// emission tests poll rather than sleeping a fixed amount.
    fn wait_for_event(payloads: &Arc<Mutex<Vec<serde_json::Value>>>, timeout: Duration) -> usize {
        let start = Instant::now();
        loop {
            let n = payloads.lock().unwrap().len();
            if n > 0 || start.elapsed() >= timeout {
                return n;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn file_change_relevant_for_modify_and_create() {
        let md = PathBuf::from("/watch/note.md");
        assert!(is_relevant_file_change(&event(
            EventKind::Modify(ModifyKind::Any),
            vec![md.clone()]
        )));
        assert!(is_relevant_file_change(&event(
            EventKind::Create(CreateKind::Any),
            vec![md.clone()]
        )));
        assert!(!is_relevant_file_change(&event(
            EventKind::Remove(RemoveKind::Any),
            vec![md]
        )));
    }

    #[test]
    fn forward_file_event_emits_for_relevant_events() {
        let mut fired = false;
        forward_file_event(
            Ok(event(
                EventKind::Modify(ModifyKind::Any),
                vec![PathBuf::from("/watch/note.md")],
            )),
            || fired = true,
        );
        assert!(fired);
    }

    #[test]
    fn forward_file_event_skips_irrelevant_events() {
        let mut fired = false;
        forward_file_event(
            Ok(event(
                EventKind::Remove(RemoveKind::Any),
                vec![PathBuf::from("/watch/note.md")],
            )),
            || fired = true,
        );
        assert!(!fired);
    }

    #[test]
    fn forward_file_event_drops_watcher_errors() {
        let mut fired = false;
        let failure = Err(notify::Error::generic("backend failure"));
        forward_file_event(failure, || fired = true);
        assert!(!fired);
    }

    /// What an event of `kind` naming `names` below `root` leaves out of date.
    fn change(kind: EventKind, root: &Path, names: &[&str]) -> Option<DirectoryChange> {
        let paths = names.iter().map(|name| root.join(name)).collect();
        directory_change(&event(kind, paths), root)
    }

    /// A workspace on disk, so the cases that look an entry up find it: every
    /// kind of document, files that are not documents, and a folder.
    fn workspace_with_entries(name: &str) -> PathBuf {
        let root = unique_tmp(name);
        for file in [
            "notes.md",
            "board.canvas",
            "analysis.ipynb",
            "diagram.d2",
            "photo.png",
            "sketch.excalidraw",
            "LICENSE",
        ] {
            std::fs::write(root.join(file), b"x").unwrap();
        }
        std::fs::create_dir_all(root.join("folder")).unwrap();
        root
    }

    const CAME_OR_WENT: [EventKind; 4] = [
        EventKind::Create(CreateKind::File),
        EventKind::Create(CreateKind::Any),
        EventKind::Remove(RemoveKind::Any),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)),
    ];

    const EDITS: [EventKind; 3] = [
        EventKind::Modify(ModifyKind::Any),
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
    ];

    #[test]
    fn a_document_coming_going_or_renamed_is_a_document_change() {
        // On disk, so only its name can make it one. Quick Open lists notebooks
        // and D2 files too.
        let root = workspace_with_entries("documents");
        for name in ["notes.md", "board.canvas", "analysis.ipynb", "diagram.d2"] {
            for kind in CAME_OR_WENT
                .into_iter()
                .chain([EventKind::Remove(RemoveKind::File)])
            {
                assert_eq!(
                    change(kind, &root, &[name]),
                    Some(DirectoryChange::Documents),
                    "{name} {kind:?}"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_an_edit_to_a_note_or_canvas_reaches_the_index() {
        // The tree shows no content or modification times, and only the index
        // reads content: an image or a folder changed in place changes nothing.
        let root = workspace_with_entries("edits");
        for kind in EDITS {
            for name in ["notes.md", "board.canvas"] {
                assert_eq!(
                    change(kind, &root, &[name]),
                    Some(DirectoryChange::Documents),
                    "{name} {kind:?}"
                );
            }
            for name in ["analysis.ipynb", "diagram.d2", "photo.png", "folder"] {
                assert_eq!(change(kind, &root, &[name]), None, "{name} {kind:?}");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_that_is_not_a_document_changes_only_the_listing() {
        // An image, a plugin's file type, or any other file the tree may list.
        let root = workspace_with_entries("listing");
        for name in ["photo.png", "sketch.excalidraw", "LICENSE"] {
            for kind in [
                EventKind::Create(CreateKind::File),
                EventKind::Create(CreateKind::Any),
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            ] {
                assert_eq!(
                    change(kind, &root, &[name]),
                    Some(DirectoryChange::Listing),
                    "{name} {kind:?}"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_coming_in_is_a_document_change() {
        // It may hold documents, whatever its name looks like.
        let root = workspace_with_entries("folder");
        for kind in [
            EventKind::Create(CreateKind::Folder),
            EventKind::Create(CreateKind::Any),
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
        ] {
            assert_eq!(
                change(kind, &root, &["folder"]),
                Some(DirectoryChange::Documents),
                "{kind:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_entry_that_is_gone_is_a_document_change() {
        // Once it is gone nothing says it was not a folder of notes: a folder
        // moved to the Trash is reported as one rename, not file by file.
        let root = workspace_with_entries("gone");
        for kind in [
            EventKind::Remove(RemoveKind::Any),
            EventKind::Remove(RemoveKind::Folder),
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
        ] {
            assert_eq!(
                change(kind, &root, &["gone.png"]),
                Some(DirectoryChange::Documents),
                "{kind:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_removal_the_backend_reports_as_a_file_changes_only_the_listing() {
        // inotify and FSEvents say what went; a file that is not a document
        // held none, so deleting a build folder does not re-index per file.
        let root = workspace_with_entries("removed_file");
        let removed = EventKind::Remove(RemoveKind::File);
        assert_eq!(
            change(removed, &root, &["gone.png"]),
            Some(DirectoryChange::Listing)
        );
        assert_eq!(
            change(removed, &root, &["gone.md"]),
            Some(DirectoryChange::Documents)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_the_index_never_walks_changes_only_the_listing() {
        // The tree lists `node_modules` and `target`, but neither the document
        // list nor the index holds anything inside them.
        let root = Path::new("/p");
        for name in [
            "node_modules",
            "node_modules/pkg/README.md",
            "docs/target/notes.md",
        ] {
            for kind in CAME_OR_WENT {
                assert_eq!(
                    change(kind, root, &[name]),
                    Some(DirectoryChange::Listing),
                    "{name} {kind:?}"
                );
            }
            for kind in EDITS {
                assert_eq!(change(kind, root, &[name]), None, "{name} {kind:?}");
            }
        }
        assert_eq!(
            change(
                EventKind::Create(CreateKind::File),
                root,
                &["targets/notes.md"]
            ),
            Some(DirectoryChange::Documents),
            "only whole folder names are skipped"
        );
    }

    #[test]
    fn an_event_counts_its_strongest_path() {
        let root = workspace_with_entries("strongest");
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        assert_eq!(
            change(rename, &root, &["photo.png", "photo.png.tmp"]),
            Some(DirectoryChange::Documents),
            "the side that is gone decides, wherever it comes"
        );
        assert_eq!(
            change(rename, &root, &["photo.png", "sketch.excalidraw"]),
            Some(DirectoryChange::Listing)
        );
        assert_eq!(
            change(rename, &root, &[".draft.md", "notes.md"]),
            Some(DirectoryChange::Documents),
            "a hidden side does not hide the other"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hidden_entries_change_nothing() {
        // Neither the tree nor the index reads them, so a commit writing under
        // `.git` must not refresh anything.
        let root = Path::new("/p");
        for name in [
            ".git/objects/ab",
            ".obsidian/workspace.md",
            ".hidden.md",
            "notes/.draft.md",
        ] {
            for kind in CAME_OR_WENT.into_iter().chain(EDITS) {
                assert_eq!(change(kind, root, &[name]), None, "{name} {kind:?}");
            }
        }
    }

    #[test]
    fn a_workspace_inside_a_hidden_folder_still_reports() {
        let root = Path::new("/home/u/.config/notes");
        let created = EventKind::Create(CreateKind::File);
        assert_eq!(
            change(created, root, &["a.md"]),
            Some(DirectoryChange::Documents)
        );
        assert_eq!(change(created, root, &[".cache/a.md"]), None);
    }

    #[test]
    fn the_watched_folder_itself_changes_nothing() {
        let root = Path::new("/p");
        for kind in [
            EventKind::Remove(RemoveKind::Folder),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
        ] {
            let itself = event(kind, vec![root.to_path_buf()]);
            assert_eq!(directory_change(&itself, root), None, "{kind:?}");
        }
    }

    #[test]
    fn access_other_and_empty_events_change_nothing() {
        let root = Path::new("/p");
        for kind in [
            EventKind::Access(AccessKind::Read),
            EventKind::Other,
            EventKind::Any,
        ] {
            assert_eq!(change(kind, root, &["notes.md"]), None, "{kind:?}");
        }
        assert_eq!(change(EventKind::Create(CreateKind::File), root, &[]), None);
    }

    #[test]
    fn a_link_to_a_folder_changes_only_the_listing() {
        // Followed, it would read as a folder of documents. A junction on
        // Windows, which needs no privilege to create.
        let root = workspace_with_entries("link");
        crate::vault::test_support::link_folder(&root.join("folder"), &root.join("to-folder"));
        assert_eq!(
            change(EventKind::Create(CreateKind::Any), &root, &["to-folder"]),
            Some(DirectoryChange::Listing)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Run `forward_directory_event` and return what it did, in order.
    fn forward(res: Result<Event, notify::Error>, root: &Path) -> Vec<String> {
        let log = std::cell::RefCell::new(Vec::new());
        forward_directory_event(
            res,
            root,
            |paths| log.borrow_mut().push(format!("reindex {}", paths.len())),
            |change| log.borrow_mut().push(format!("emit {change:?}")),
        );
        log.into_inner()
    }

    #[test]
    fn forward_directory_event_re_indexes_a_document_change_before_emitting() {
        let root = Path::new("/p");
        let created = event(
            EventKind::Create(CreateKind::File),
            vec![root.join("notes.md")],
        );
        assert_eq!(forward(Ok(created), root), ["reindex 1", "emit Documents"]);
    }

    #[test]
    fn forward_directory_event_emits_a_listing_change_without_re_indexing() {
        let root = workspace_with_entries("forward_listing");
        let created = event(
            EventKind::Create(CreateKind::File),
            vec![root.join("photo.png")],
        );
        assert_eq!(forward(Ok(created), &root), ["emit Listing"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn forward_directory_event_drops_errors_and_unchanged_events() {
        let root = Path::new("/p");
        let read = event(
            EventKind::Access(AccessKind::Read),
            vec![root.join("notes.md")],
        );
        assert!(forward(Ok(read), root).is_empty());
        assert!(forward(Err(notify::Error::generic("backend failure")), root).is_empty());
    }

    #[test]
    fn watch_file_registers_the_path_in_state() {
        let dir = unique_tmp("watch_file");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        assert!(watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());

        assert!(is_watched(&app, &path));
        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_file_is_idempotent_for_the_same_path() {
        let dir = unique_tmp("watch_file_idem");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        assert!(watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());
        // Second call hits the early `contains_key` return and must not add a
        // duplicate entry.
        assert!(watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());

        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_file_errors_for_a_nonexistent_path() {
        let dir = unique_tmp("watch_file_missing");
        let missing = dir.join("does-not-exist.md");
        let path = missing.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let result = watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err(), "watching a missing path should fail");
        // A failed watch must not leave a dangling entry behind.
        assert!(!is_watched(&app, &path));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unwatch_file_removes_the_registered_path() {
        let dir = unique_tmp("unwatch_file");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(watched_count(&app), 1);

        assert!(unwatch_file(path.clone(), app.handle().clone()).is_ok());
        assert!(!is_watched(&app, &path));
        assert_eq!(watched_count(&app), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unwatch_file_for_an_unknown_path_is_a_noop() {
        let app = mock_app_with_state();
        assert!(unwatch_file("/never/watched.md".to_string(), app.handle().clone()).is_ok());
        assert_eq!(watched_count(&app), 0);
    }

    #[test]
    fn watch_directory_registers_the_path_in_state() {
        let dir = unique_tmp("watch_dir");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        assert!(watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());

        assert!(is_watched(&app, &path));
        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_directory_is_idempotent_for_the_same_path() {
        let dir = unique_tmp("watch_dir_idem");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        assert!(watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());
        assert!(watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());

        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_directory_errors_for_a_nonexistent_path() {
        let dir = unique_tmp("watch_dir_missing");
        let missing = dir.join("no-such-dir");
        let path = missing.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let result = watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err(), "watching a missing directory should fail");
        assert!(!is_watched(&app, &path));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unwatch_directory_removes_the_registered_path() {
        let dir = unique_tmp("unwatch_dir");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(watched_count(&app), 1);

        assert!(unwatch_directory(path.clone(), app.handle().clone()).is_ok());
        assert!(!is_watched(&app, &path));
        assert_eq!(watched_count(&app), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unwatch_directory_for_an_unknown_path_is_a_noop() {
        let app = mock_app_with_state();
        assert!(unwatch_directory("/never/watched".to_string(), app.handle().clone()).is_ok());
        assert_eq!(watched_count(&app), 0);
    }

    #[test]
    fn watch_commands_are_denied_without_a_grant() {
        let dir = unique_tmp("watch_denied");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();

        let app = mock_app_with_state();
        let file_result = watch_file(
            file.to_string_lossy().to_string(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        );
        let dir_result = watch_directory(
            dir.to_string_lossy().to_string(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        );

        for result in [file_result, dir_result] {
            let err = result.expect_err("must be denied");
            assert!(err.starts_with("path is outside the allowed workspaces and files:"));
        }
        assert_eq!(watched_count(&app), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_file_emits_file_changed_when_the_file_is_modified() {
        let dir = unique_tmp("watch_file_emit");
        let file = dir.join("note.md");
        std::fs::write(&file, "initial").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "file-changed");
        watch_file(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        // Modify the watched file; the watcher closure should emit on Modify.
        std::fs::write(&file, "changed").unwrap();

        let count = wait_for_event(&fired, Duration::from_secs(10));
        assert!(count > 0, "expected at least one file-changed emit");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_directory_emits_directory_changed_when_a_markdown_file_appears() {
        let dir = unique_tmp("watch_dir_emit");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "directory-changed");
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        // Creating a markdown file inside the watched dir is a relevant change.
        std::fs::write(dir.join("new.md"), "# hi").unwrap();

        let count = wait_for_event(&fired, Duration::from_secs(10));
        assert!(count > 0, "expected at least one directory-changed emit");
        assert_eq!(
            fired.lock().unwrap()[0],
            serde_json::json!({ "root": path, "documentsChanged": true })
        );
        // The index for this root is built lazily by the command surface, so
        // an event arriving before that has nothing to update and must not
        // panic the watcher thread.
        assert!(app.state::<VaultStore>().0.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_watched_directory_re_indexes_before_it_emits() {
        let dir = unique_tmp("watch_dir_reindex");
        let path = dir.to_string_lossy().to_string();
        std::fs::write(
            dir.join("first.md"),
            "links [[second]]
",
        )
        .unwrap();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "directory-changed");
        let store = app.state::<VaultStore>();
        store.0.lock().unwrap().insert(
            std::fs::canonicalize(&dir).unwrap(),
            crate::vault::Vault::build(&dir).unwrap(),
        );
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        std::fs::write(dir.join("second.md"), "# second").unwrap();
        assert!(wait_for_event(&fired, Duration::from_secs(10)) > 0);

        // Asserted without waiting: the re-index runs before the emit, so the
        // event the frontend just saw already implies a current index. Polling
        // here would pass even if that order were reversed.
        let indexed = store.0.lock().unwrap()[&std::fs::canonicalize(&dir).unwrap()]
            .snapshot()
            .files
            .len();
        assert_eq!(indexed, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_image_in_a_watched_directory_changes_only_the_listing() {
        let dir = unique_tmp("watch_dir_image");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "directory-changed");
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        std::fs::write(dir.join("photo.png"), b"x").unwrap();
        assert!(wait_for_event(&fired, Duration::from_secs(10)) > 0);

        for payload in fired.lock().unwrap().iter() {
            assert_eq!(
                *payload,
                serde_json::json!({ "root": path, "documentsChanged": false })
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_moved_out_of_a_watched_directory_leaves_the_index() {
        // Moving a folder to the Trash is one rename, with nothing reported for
        // the notes inside it.
        let parent = unique_tmp("watch_dir_moved_out");
        let dir = parent.join("workspace");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("note.md"), "# note").unwrap();
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "directory-changed");
        let store = app.state::<VaultStore>();
        let key = std::fs::canonicalize(&dir).unwrap();
        let vault = crate::vault::Vault::build(&dir).unwrap();
        store.0.lock().unwrap().insert(key.clone(), vault);
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        std::fs::rename(dir.join("sub"), parent.join("moved")).unwrap();
        assert!(wait_for_event(&fired, Duration::from_secs(10)) > 0);

        assert_eq!(
            fired.lock().unwrap()[0],
            serde_json::json!({ "root": path, "documentsChanged": true })
        );
        // Without waiting, as above: the re-index ran before the emit.
        assert!(store.0.lock().unwrap()[&key].snapshot().files.is_empty());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn two_calls_watching_the_same_directory_together_register_it_once() {
        let dir = unique_tmp("watch_dir_race");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        // The lock is released while a watch registers, so both calls can
        // pass the "already watching" check and reach the map with a watcher.
        std::thread::scope(|scope| {
            for _ in 0..2 {
                let handle = app.handle().clone();
                let path = path.clone();
                scope.spawn(move || {
                    watch_directory(path, handle.clone(), handle.state::<GrantRegistry>()).unwrap()
                });
            }
        });

        assert!(is_watched(&app, &path));
        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Unix-only: creating a symlink on Windows needs elevation or Developer Mode.
    #[cfg(unix)]
    #[test]
    fn a_directory_watch_does_not_follow_a_link_out_of_the_folder() {
        let parent = unique_tmp("watch_dir_link");
        let dir = parent.join("workspace");
        let outside = parent.join("outside");
        std::fs::create_dir_all(dir.join("real")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("link")).unwrap();
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        let fired = record_event(&app, "directory-changed");
        watch_directory(
            path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();

        // Written through the link, as the workspace would spell it; with the
        // link followed, this directory would be watched and the write seen.
        std::fs::write(dir.join("link").join("new.md"), "# outside").unwrap();
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(
            fired.lock().unwrap().len(),
            0,
            "a write behind a link must not reach the watch"
        );

        // The watch itself is live: a real subfolder still reports.
        std::fs::write(dir.join("real").join("new.md"), "# inside").unwrap();
        assert!(wait_for_event(&fired, Duration::from_secs(10)) > 0);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn drop_watches_releases_the_paths_a_closing_window_owned() {
        // Nothing else unwatches on window teardown, so these would otherwise
        // stay live for the rest of the session.
        let dir = unique_tmp("drop_watches");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let file_path = file.to_string_lossy().to_string();
        let dir_path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        grant_dir(&app, &dir);
        watch_file(
            file_path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        watch_directory(
            dir_path.clone(),
            app.handle().clone(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(watched_count(&app), 2);

        drop_watches(app.handle(), &[file_path.clone(), dir_path.clone()]);

        assert!(!is_watched(&app, &file_path));
        assert!(!is_watched(&app, &dir_path));
        assert_eq!(watched_count(&app), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drop_watches_ignores_paths_that_were_never_watched() {
        let app = mock_app_with_state();
        drop_watches(app.handle(), &["/never/watched.md".to_string()]);
        assert_eq!(watched_count(&app), 0);
    }

    #[test]
    fn drop_watches_tolerates_a_poisoned_lock() {
        // Teardown runs on a window-destroyed event with nowhere to report an
        // error, so a poisoned lock leaves the watches in place rather than
        // panicking the event handler.
        let app = mock_app_with_state();
        let watchers = Arc::clone(&app.state::<FileWatcherState>().0);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = watchers.lock().unwrap();
            panic!("poison");
        }));

        drop_watches(app.handle(), &["/a/note.md".to_string()]);
    }

    #[test]
    fn drop_watches_without_managed_state_is_a_no_op() {
        // A window can be destroyed during shutdown, after state teardown.
        let app = tauri::test::mock_app();
        drop_watches(app.handle(), &["/a/note.md".to_string()]);
    }
}
