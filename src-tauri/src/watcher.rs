use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

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

#[tauri::command]
pub fn watch_file(path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    // Already watching this path
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    let _ = app_handle.emit("file-changed", &watched_path);
                }
                _ => {}
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {e}"))?;

    watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    watchers.remove(&path);
    Ok(())
}

#[tauri::command]
pub fn watch_directory(path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    if watchers.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let watched_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if is_relevant_directory_change(&event) {
                let _ = app_handle.emit("directory-changed", &watched_path);
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_directory(path: String, app: AppHandle) -> Result<(), String> {
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

    fn event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
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
}
