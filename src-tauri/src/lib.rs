mod commands;
mod menu;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::{DragDropEvent, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn"];

fn is_markdown_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MD_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(FileWatcherState(Arc::new(Mutex::new(None))))
        .manage(commands::InitialFile(Mutex::new(None)))
        .setup(|app| {
            let menu = menu::build_menu(app)?;
            app.set_menu(menu)?;

            // Parse CLI arguments and store initial file path
            if let Ok(matches) = app.cli().matches() {
                if let Some(file_arg) = matches.args.get("file") {
                    if let Some(path_str) = file_arg.value.as_str() {
                        if !path_str.is_empty() {
                            let path = std::path::Path::new(path_str);
                            let absolute = if path.is_absolute() {
                                path.to_path_buf()
                            } else {
                                std::env::current_dir()
                                    .unwrap_or_default()
                                    .join(path)
                            };
                            let abs_str = absolute.to_string_lossy().to_string();
                            {
                                let state = app.state::<commands::InitialFile>();
                                let mut guard = state.0.lock().unwrap();
                                *guard = Some(abs_str);
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            // Handle drag and drop of markdown files
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                for path in paths {
                    if is_markdown_file(path) {
                        let path_str = path.to_string_lossy().to_string();
                        let _ = window.emit("open-file", &path_str);
                        break; // Only open the first markdown file
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::get_file_metadata,
            commands::get_initial_file,
            watcher::watch_file,
            watcher::unwatch_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Glyph");

    app.run(|app_handle, event| {
        if let RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();

                    // Try to emit to the frontend (works if webview is ready)
                    let emitted = app_handle.emit("open-file", &path_str).is_ok();

                    // Also store in InitialFile state as fallback (for when
                    // the webview hasn't loaded yet on first launch)
                    if emitted {
                        if let Some(state) = app_handle.try_state::<commands::InitialFile>() {
                            let mut guard = state.0.lock().unwrap();
                            *guard = Some(path_str);
                        }
                    }
                    break; // Only open the first file
                }
            }
        }
    });
}
