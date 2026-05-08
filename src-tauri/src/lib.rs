mod commands;
mod menu;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

// Single source of truth shared with the frontend
// (src/lib/markdownExtensions.ts imports the same JSON).
// build.rs reads markdown-extensions.json at compile time and emits this const.
include!(concat!(env!("OUT_DIR"), "/md_extensions.rs"));

pub fn is_markdown_file(path: &std::path::Path) -> bool {
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(FileWatcherState(Arc::new(Mutex::new(std::collections::HashMap::new()))))
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
                                // Try current dir first, then TAURI_INVOKE_ORIGIN or parent
                                let from_cwd = std::env::current_dir()
                                    .unwrap_or_default()
                                    .join(path);
                                if from_cwd.exists() {
                                    from_cwd
                                } else {
                                    // In dev mode, cwd is src-tauri/ — try parent
                                    let from_parent = std::env::current_dir()
                                        .unwrap_or_default()
                                        .join("..")
                                        .join(path);
                                    if from_parent.exists() {
                                        from_parent
                                    } else {
                                        from_cwd
                                    }
                                }
                            };
                            if let Ok(canonical) = absolute.canonicalize() {
                                let abs_str = canonical.to_string_lossy().to_string();
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
            commands::write_file,
            commands::get_file_metadata,
            commands::get_initial_file,
            commands::print_document,
            commands::read_directory,
            commands::list_markdown_files,
            commands::scan_wikilinks,
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

                    // Try to emit to the frontend (works if webview is ready)
                    let emitted = _app_handle.emit("open-file", &path_str).is_ok();

                    // Also store in InitialFile state as fallback (for when
                    // the webview hasn't loaded yet on first launch)
                    if emitted {
                        if let Some(state) = _app_handle.try_state::<commands::InitialFile>() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn md_extension() {
        assert!(is_markdown_file(Path::new("README.md")));
    }

    #[test]
    fn markdown_extension() {
        assert!(is_markdown_file(Path::new("notes.markdown")));
    }

    #[test]
    fn mdown_extension() {
        assert!(is_markdown_file(Path::new("doc.mdown")));
    }

    #[test]
    fn mkd_extension() {
        assert!(is_markdown_file(Path::new("file.mkd")));
    }

    #[test]
    fn mkdn_extension() {
        assert!(is_markdown_file(Path::new("file.mkdn")));
    }

    #[test]
    fn mdx_extension() {
        assert!(is_markdown_file(Path::new("doc.mdx")));
    }

    #[test]
    fn case_insensitive() {
        assert!(is_markdown_file(Path::new("README.MD")));
        assert!(is_markdown_file(Path::new("readme.Md")));
    }

    #[test]
    fn not_markdown_txt() {
        assert!(!is_markdown_file(Path::new("file.txt")));
    }

    #[test]
    fn not_markdown_rs() {
        assert!(!is_markdown_file(Path::new("main.rs")));
    }

    #[test]
    fn not_markdown_no_extension() {
        assert!(!is_markdown_file(Path::new("Makefile")));
    }

    #[test]
    fn not_markdown_hidden_file() {
        assert!(!is_markdown_file(Path::new(".gitignore")));
    }

    #[test]
    fn with_directory_path() {
        assert!(is_markdown_file(Path::new("/home/user/docs/README.md")));
        assert!(is_markdown_file(Path::new("./relative/path/notes.markdown")));
    }

    #[test]
    fn empty_path() {
        assert!(!is_markdown_file(Path::new("")));
    }
}
