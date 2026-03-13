use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct FileWatcherState(pub Arc<Mutex<Option<RecommendedWatcher>>>);

#[tauri::command]
pub fn watch_file(path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watcher_lock = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    // Drop the previous watcher to stop watching the old file
    *watcher_lock = None;

    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    let _ = app_handle.emit("file-changed", ());
                }
                _ => {}
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {e}"))?;

    *watcher_lock = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(app: AppHandle) -> Result<(), String> {
    let state = app.state::<FileWatcherState>();
    let mut watcher_lock = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    *watcher_lock = None;
    Ok(())
}
