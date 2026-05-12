mod cli;
mod commands;
mod markdown;
mod menu;
mod watcher;

use std::sync::{Arc, Mutex};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

pub use markdown::is_markdown_file;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(FileWatcherState(Arc::new(Mutex::new(
            std::collections::HashMap::new(),
        ))))
        .manage(commands::InitialFile(Mutex::new(None)))
        .manage(commands::InitialFolder(Mutex::new(None)))
        .setup(|app| {
            let menu = menu::build_menu(app)?;
            app.set_menu(menu)?;

            // Parse CLI arguments and store initial file path
            if let Ok(matches) = app.cli().matches() {
                if let Some(file_arg) = matches.args.get("file") {
                    if let Some(path_str) = file_arg.value.as_str() {
                        let cwd = std::env::current_dir().unwrap_or_default();
                        if let Some(canonical) = cli::resolve_initial_path(path_str, &cwd) {
                            let abs_str = canonical.to_string_lossy().to_string();
                            if canonical.is_dir() {
                                let state = app.state::<commands::InitialFolder>();
                                let mut guard = state.0.lock().unwrap();
                                *guard = Some(abs_str);
                            } else {
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
            // Handle drag and drop of folders or markdown files. First match wins:
            // a directory opens as a workspace, a markdown file opens as a single-file tab.
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                for path in paths {
                    let path_str = path.to_string_lossy().to_string();
                    if path.is_dir() {
                        let _ = window.emit("open-folder", &path_str);
                        break;
                    }
                    if is_markdown_file(path) {
                        let _ = window.emit("open-file", &path_str);
                        break;
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::get_file_metadata,
            commands::file::get_initial_file,
            commands::file::print_document,
            commands::directory::get_initial_folder,
            commands::directory::read_directory,
            commands::directory::list_markdown_files,
            commands::wikilinks::scan_wikilinks,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::watch_directory,
            watcher::unwatch_directory,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Glyph");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    let is_folder = path.is_dir();
                    let event_name = if is_folder {
                        "open-folder"
                    } else {
                        "open-file"
                    };

                    // Try to emit to the frontend (works if webview is ready)
                    let emitted = _app_handle.emit(event_name, &path_str).is_ok();

                    // Also store as fallback for when the webview hasn't loaded yet
                    // (cold-launch via Finder open-with).
                    if emitted {
                        if is_folder {
                            if let Some(state) = _app_handle.try_state::<commands::InitialFolder>()
                            {
                                let mut guard = state.0.lock().unwrap();
                                *guard = Some(path_str);
                            }
                        } else if let Some(state) = _app_handle.try_state::<commands::InitialFile>()
                        {
                            let mut guard = state.0.lock().unwrap();
                            *guard = Some(path_str);
                        }
                    }
                    break; // Only open the first path
                }
            }
        }
    });
}
