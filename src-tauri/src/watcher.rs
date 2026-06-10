use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub struct FileWatcherState(pub Arc<Mutex<HashMap<String, RecommendedWatcher>>>);

/// A directory watch should fire when a markdown file or a sub-directory is
/// added, removed, renamed, or modified. Everything else (e.g. attribute-only
/// changes, non-markdown sibling files) is filtered out so the frontend isn't
/// flooded with refreshes. Extracted as a pure helper so we can test the
/// filter without booting a Tauri app.
pub fn is_relevant_directory_change(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    ) && event
        .paths
        .iter()
        .any(|p| crate::is_markdown_file(p) || p.is_dir())
}

/// A file watch should fire when the watched file's content changes. Editors
/// commonly save by replacing the file, so creations count as changes too.
/// Extracted as a pure helper so the filter is testable without a live watcher.
pub fn is_relevant_file_change(event: &Event) -> bool {
    matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_))
}

/// Shared body of the `notify` callbacks: drop watcher errors, filter the
/// event through `is_relevant`, and emit when it passes. Extracted so the
/// error and filtered-out arms are testable — a live watcher only delivers
/// them on hard-to-reproduce filesystem conditions.
fn forward_watch_event(
    res: Result<Event, notify::Error>,
    is_relevant: fn(&Event) -> bool,
    emit: impl FnOnce(),
) {
    if let Ok(event) = res {
        if is_relevant(&event) {
            emit();
        }
    }
}

#[tauri::command]
pub fn watch_file<R: Runtime>(path: String, app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    // Already watching this path
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        forward_watch_event(res, is_relevant_file_change, || {
            let _ = app_handle.emit("file-changed", &watched_path);
        });
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {e}"))?;

    watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file<R: Runtime>(path: String, app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    watchers.remove(&path);
    Ok(())
}

#[tauri::command]
pub fn watch_directory<R: Runtime>(path: String, app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    if watchers.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        forward_watch_event(res, is_relevant_directory_change, || {
            let _ = app_handle.emit("directory-changed", &watched_path);
        });
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    watchers.insert(path, watcher);
    Ok(())
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
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    use std::path::PathBuf;
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
        app
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

    /// Subscribe to `event` on the app handle, returning a shared counter that
    /// the listener bumps every time the event fires.
    fn count_event(app: &App<MockRuntime>, event: &'static str) -> Arc<Mutex<usize>> {
        let counter: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&counter);
        app.handle().listen(event, move |_| {
            *sink.lock().unwrap() += 1;
        });
        counter
    }

    /// Poll `counter` until it is non-zero or `timeout` elapses. Returns the
    /// final count. Filesystem-notification latency varies by platform, so the
    /// emission tests poll rather than sleeping a fixed amount.
    fn wait_for_event(counter: &Arc<Mutex<usize>>, timeout: Duration) -> usize {
        let start = Instant::now();
        loop {
            let n = *counter.lock().unwrap();
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
    fn forward_watch_event_emits_for_relevant_events() {
        let mut fired = false;
        forward_watch_event(
            Ok(event(
                EventKind::Modify(ModifyKind::Any),
                vec![PathBuf::from("/watch/note.md")],
            )),
            is_relevant_file_change,
            || fired = true,
        );
        assert!(fired);
    }

    #[test]
    fn forward_watch_event_skips_irrelevant_events() {
        let mut fired = false;
        forward_watch_event(
            Ok(event(
                EventKind::Remove(RemoveKind::Any),
                vec![PathBuf::from("/watch/note.md")],
            )),
            is_relevant_file_change,
            || fired = true,
        );
        assert!(!fired);
    }

    #[test]
    fn forward_watch_event_drops_watcher_errors() {
        let mut fired = false;
        forward_watch_event(
            Err(notify::Error::generic("backend failure")),
            is_relevant_file_change,
            || fired = true,
        );
        assert!(!fired);
    }

    #[test]
    fn relevant_when_markdown_file_is_created() {
        let e = event(
            EventKind::Create(CreateKind::File),
            vec![PathBuf::from("/p/notes.md")],
        );
        assert!(is_relevant_directory_change(&e));
    }

    #[test]
    fn relevant_when_markdown_file_is_removed() {
        let e = event(
            EventKind::Remove(RemoveKind::File),
            vec![PathBuf::from("/p/notes.md")],
        );
        assert!(is_relevant_directory_change(&e));
    }

    #[test]
    fn relevant_when_markdown_file_is_modified() {
        let e = event(
            EventKind::Modify(ModifyKind::Any),
            vec![PathBuf::from("/p/notes.md")],
        );
        assert!(is_relevant_directory_change(&e));
    }

    #[test]
    fn not_relevant_for_non_markdown_files() {
        let e = event(
            EventKind::Create(CreateKind::File),
            vec![
                PathBuf::from("/p/image.png"),
                PathBuf::from("/p/binary.bin"),
            ],
        );
        assert!(!is_relevant_directory_change(&e));
    }

    #[test]
    fn not_relevant_for_access_or_other_event_kinds() {
        let e = event(
            EventKind::Access(notify::event::AccessKind::Read),
            vec![PathBuf::from("/p/notes.md")],
        );
        assert!(!is_relevant_directory_change(&e));

        let other = event(EventKind::Other, vec![PathBuf::from("/p/notes.md")]);
        assert!(!is_relevant_directory_change(&other));
    }

    #[test]
    fn relevant_for_directory_create_even_if_not_markdown() {
        let dir = std::env::temp_dir().join(format!(
            "glyph_watcher_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let e = event(EventKind::Create(CreateKind::Folder), vec![dir.clone()]);
        assert!(is_relevant_directory_change(&e));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn not_relevant_when_paths_are_empty() {
        let e = event(EventKind::Create(CreateKind::File), vec![]);
        assert!(!is_relevant_directory_change(&e));
    }

    #[test]
    fn watch_file_registers_the_path_in_state() {
        let dir = unique_tmp("watch_file");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        assert!(watch_file(path.clone(), app.handle().clone()).is_ok());

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
        assert!(watch_file(path.clone(), app.handle().clone()).is_ok());
        // Second call hits the early `contains_key` return and must not add a
        // duplicate entry.
        assert!(watch_file(path.clone(), app.handle().clone()).is_ok());

        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_file_errors_for_a_nonexistent_path() {
        let dir = unique_tmp("watch_file_missing");
        let missing = dir.join("does-not-exist.md");
        let path = missing.to_string_lossy().to_string();

        let app = mock_app_with_state();
        let result = watch_file(path.clone(), app.handle().clone());

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
        watch_file(path.clone(), app.handle().clone()).unwrap();
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
        assert!(watch_directory(path.clone(), app.handle().clone()).is_ok());

        assert!(is_watched(&app, &path));
        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_directory_is_idempotent_for_the_same_path() {
        let dir = unique_tmp("watch_dir_idem");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        assert!(watch_directory(path.clone(), app.handle().clone()).is_ok());
        assert!(watch_directory(path.clone(), app.handle().clone()).is_ok());

        assert_eq!(watched_count(&app), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_directory_errors_for_a_nonexistent_path() {
        let dir = unique_tmp("watch_dir_missing");
        let missing = dir.join("no-such-dir");
        let path = missing.to_string_lossy().to_string();

        let app = mock_app_with_state();
        let result = watch_directory(path.clone(), app.handle().clone());

        assert!(result.is_err(), "watching a missing directory should fail");
        assert!(!is_watched(&app, &path));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unwatch_directory_removes_the_registered_path() {
        let dir = unique_tmp("unwatch_dir");
        let path = dir.to_string_lossy().to_string();

        let app = mock_app_with_state();
        watch_directory(path.clone(), app.handle().clone()).unwrap();
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
    fn watch_file_emits_file_changed_when_the_file_is_modified() {
        let dir = unique_tmp("watch_file_emit");
        let file = dir.join("note.md");
        std::fs::write(&file, "initial").unwrap();
        let path = file.to_string_lossy().to_string();

        let app = mock_app_with_state();
        let fired = count_event(&app, "file-changed");
        watch_file(path.clone(), app.handle().clone()).unwrap();

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
        let fired = count_event(&app, "directory-changed");
        watch_directory(path.clone(), app.handle().clone()).unwrap();

        // Creating a markdown file inside the watched dir is a relevant change.
        std::fs::write(dir.join("new.md"), "# hi").unwrap();

        let count = wait_for_event(&fired, Duration::from_secs(10));
        assert!(count > 0, "expected at least one directory-changed emit");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
