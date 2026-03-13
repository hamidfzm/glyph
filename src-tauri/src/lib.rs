mod commands;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(FileWatcherState(Arc::new(Mutex::new(None))))
        .manage(commands::InitialFile(Mutex::new(None)))
        .setup(|app| {
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
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::get_file_metadata,
            commands::get_initial_file,
            watcher::watch_file,
            watcher::unwatch_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glyph");
}
