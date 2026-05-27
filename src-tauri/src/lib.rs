mod cli;
mod commands;
mod markdown;
mod menu;
mod menu_runtime;
mod sync;
mod watcher;

use std::sync::{Arc, Mutex};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

pub use markdown::is_markdown_file;

/// Handle a second-instance launch: refocus the main window and forward the
/// file/folder argument (if any) to the frontend via the same `open-file` /
/// `open-folder` events used by drag-and-drop and macOS RunEvent::Opened.
///
/// Generic over Tauri's runtime so we can drive it with `tauri::test::MockRuntime`
/// in unit tests without a real window manager.
pub fn handle_second_instance<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    argv: Vec<String>,
    cwd_str: String,
) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    if let Some(event) = cli::second_instance_event(&argv, &std::path::PathBuf::from(&cwd_str)) {
        let _ = app_handle.emit(event.event_name, &event.path);
    }
}

/// Build a fresh `tauri::Builder` with the platform-conditional single-instance
/// plugin registered on Windows and Linux. macOS routes second launches via
/// `RunEvent::Opened`, so it gets a vanilla builder.
///
/// Extracted from `run()` so the cfg-gated branches can be unit-tested without
/// actually starting the Tauri runtime.
pub fn make_app_builder() -> tauri::Builder<tauri::Wry> {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(handle_second_instance));

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let builder = tauri::Builder::default();

    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = make_app_builder()
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
        .manage(sync::SyncState::new())
        .setup(|app| {
            let (menu, menu_refs) = menu::build_menu(app)?;
            app.set_menu(menu)?;
            // Start with everything disabled — the frontend reasserts state
            // as soon as it mounts and learns about the active tab and settings.
            let initial_flags = menu::MenuStateFlags {
                has_tab: false,
                has_file: false,
                has_content: false,
                ai_configured: false,
                tts_available: false,
                cloud_sync_enabled: false,
            };
            let _ = menu::apply_menu_state(&menu_refs, &initial_flags);
            app.manage(menu_refs);

            // Parse CLI arguments and store the initial file/folder. The pure
            // classification logic lives in `cli::classify_initial_arg` (tested
            // there); this block is the thin Tauri-runtime adapter that maps
            // each variant to managed state or a warning.
            if let Ok(matches) = app.cli().matches() {
                if let Some(file_arg) = matches.args.get("file") {
                    if let Some(path_str) = file_arg.value.as_str() {
                        let cwd = std::env::current_dir().unwrap_or_default();
                        match cli::classify_initial_arg(path_str, &cwd) {
                            Some(cli::InitialOpenAction::Folder(p)) => {
                                *app.state::<commands::InitialFolder>().0.lock().unwrap() = Some(p);
                            }
                            Some(cli::InitialOpenAction::File(p)) => {
                                *app.state::<commands::InitialFile>().0.lock().unwrap() = Some(p);
                            }
                            Some(cli::InitialOpenAction::RejectedNotMarkdown(p)) => {
                                eprintln!("Refusing to open non-markdown file: {p}");
                            }
                            None => {}
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
            menu_runtime::set_menu_state,
            sync::commands::sync_set_config,
            sync::commands::sync_get_config,
            sync::commands::sync_remove_config,
            sync::commands::sync_set_token,
            sync::commands::sync_clear_token,
            sync::commands::sync_init_repo,
            sync::commands::sync_clone_remote,
            sync::commands::sync_set_origin,
            sync::commands::sync_status,
            sync::commands::sync_run,
            sync::commands::sync_default_author,
            sync::commands::sync_repo_present,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Glyph");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            for url in urls {
                let Ok(path) = url.to_file_path() else {
                    continue;
                };
                // `cli::classify_resolved_path` is the same classifier the CLI
                // arg block uses, so the file/folder gating and the
                // non-markdown rejection stay in lockstep.
                match cli::classify_resolved_path(&path) {
                    Some(cli::InitialOpenAction::Folder(p)) => {
                        if _app_handle.emit("open-folder", &p).is_ok() {
                            if let Some(state) = _app_handle.try_state::<commands::InitialFolder>()
                            {
                                *state.0.lock().unwrap() = Some(p);
                            }
                        }
                        break;
                    }
                    Some(cli::InitialOpenAction::File(p)) => {
                        if _app_handle.emit("open-file", &p).is_ok() {
                            if let Some(state) = _app_handle.try_state::<commands::InitialFile>() {
                                *state.0.lock().unwrap() = Some(p);
                            }
                        }
                        break;
                    }
                    Some(cli::InitialOpenAction::RejectedNotMarkdown(p)) => {
                        eprintln!("Refusing to open non-markdown file: {p}");
                        // Keep scanning the URL list — the user may have
                        // dropped a mix of markdown and non-markdown files.
                    }
                    None => {}
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::test::{mock_app, MockRuntime};
    use tauri::{Listener, WebviewWindowBuilder};

    /// Build a mock app with a "main" webview window so the
    /// `app_handle.get_webview_window("main")` branch in
    /// [`handle_second_instance`] resolves to `Some(window)`. Tests that don't
    /// care about that branch use [`mock_app`] directly.
    fn mock_app_with_main_window() -> tauri::App<MockRuntime> {
        let app = mock_app();
        WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        app
    }

    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_lib_test_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Subscribe to `event` on the mock app's handle, returning a shared
    /// vector that the listener appends payloads into.
    fn capture_event(
        app_handle: &tauri::AppHandle<tauri::test::MockRuntime>,
        event: &'static str,
    ) -> Arc<Mutex<Vec<String>>> {
        let bucket: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&bucket);
        app_handle.listen(event, move |evt| {
            // emit() serialises the payload as JSON; the raw payload string
            // wraps the path in quotes which we strip for easier asserts.
            let raw = evt.payload().to_string();
            let trimmed = raw.trim_matches('"').to_string();
            sink.lock().unwrap().push(trimmed);
        });
        bucket
    }

    #[test]
    fn handle_second_instance_emits_open_file_for_an_existing_file() {
        let cwd = unique_tmp("hsi_file");
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();
        let canonical = file.canonicalize().unwrap();

        // Use a windowed mock app so the `get_webview_window("main")` Some-arm
        // (unminimize / show / set_focus) is exercised.
        let app = mock_app_with_main_window();
        let handle = app.handle().clone();
        let files = capture_event(&handle, "open-file");
        let folders = capture_event(&handle, "open-folder");

        handle_second_instance(
            &handle,
            vec!["glyph".to_string(), "note.md".to_string()],
            cwd.to_string_lossy().to_string(),
        );

        // Give the listener loop a beat to drain the emitted event.
        std::thread::sleep(std::time::Duration::from_millis(50));

        let files_seen = files.lock().unwrap().clone();
        let folders_seen = folders.lock().unwrap().clone();
        assert_eq!(files_seen.len(), 1, "expected one open-file emit");
        assert_eq!(
            PathBuf::from(&files_seen[0]).canonicalize().unwrap(),
            canonical
        );
        assert!(folders_seen.is_empty(), "open-folder should not fire");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_second_instance_emits_open_folder_for_a_directory() {
        let cwd = unique_tmp("hsi_dir");
        let sub = cwd.join("workspace");
        fs::create_dir_all(&sub).unwrap();

        let app = mock_app();
        let handle = app.handle().clone();
        let files = capture_event(&handle, "open-file");
        let folders = capture_event(&handle, "open-folder");

        handle_second_instance(
            &handle,
            vec!["glyph".to_string(), "workspace".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        std::thread::sleep(std::time::Duration::from_millis(50));

        assert!(
            files.lock().unwrap().is_empty(),
            "open-file should not fire"
        );
        assert_eq!(
            folders.lock().unwrap().len(),
            1,
            "expected one open-folder emit"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_second_instance_with_no_path_arg_is_a_noop() {
        let cwd = unique_tmp("hsi_noop");
        let app = mock_app();
        let handle = app.handle().clone();
        let files = capture_event(&handle, "open-file");
        let folders = capture_event(&handle, "open-folder");

        handle_second_instance(
            &handle,
            vec!["glyph".to_string(), "--help".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        std::thread::sleep(std::time::Duration::from_millis(50));

        assert!(files.lock().unwrap().is_empty());
        assert!(folders.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn make_app_builder_constructs_a_builder() {
        // We can't run the resulting builder (would start a real window
        // manager), but constructing it covers the cfg-gated plugin setup.
        let builder = make_app_builder();
        std::mem::drop(builder);
    }

    #[test]
    fn handle_second_instance_silently_ignores_unresolvable_paths() {
        let cwd = unique_tmp("hsi_missing");
        let app = mock_app();
        let handle = app.handle().clone();
        let files = capture_event(&handle, "open-file");

        handle_second_instance(
            &handle,
            vec!["glyph".to_string(), "nope.md".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        std::thread::sleep(std::time::Duration::from_millis(50));

        assert!(files.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }
}
