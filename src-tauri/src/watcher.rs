use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct FileWatcherState(pub Arc<Mutex<HashMap<String, RecommendedWatcher>>>);

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
