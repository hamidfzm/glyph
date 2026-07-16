mod canvas;
mod cli;
mod commands;
mod d2;
mod image;
mod markdown;
#[cfg(desktop)]
mod menu;
#[cfg(desktop)]
mod menu_runtime;
// `tauri::menu` doesn't exist on mobile; a stub module answers the same
// commands so one `generate_handler!` list serves both targets.
#[cfg(mobile)]
#[path = "menu_runtime_mobile.rs"]
mod menu_runtime;
mod notebook;
mod secrets;
mod sync;
// Telemetry (sentry) doesn't cross-compile for mobile; a stub module
// answers the same command there. Sync gates its git backend the same
// way inside sync/mod.rs.
#[cfg(desktop)]
mod telemetry;
#[cfg(mobile)]
#[path = "telemetry_mobile.rs"]
mod telemetry;
mod watcher;
mod windows;
mod windows_runtime;
mod workspace;

use std::sync::{Arc, Mutex};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{DragDropEvent, Manager, WindowEvent};
#[cfg(desktop)]
use tauri_plugin_cli::CliExt;
use watcher::FileWatcherState;

pub use canvas::is_canvas_file;
pub use d2::is_d2_file;
pub use image::is_image_file;
pub use markdown::is_markdown_file;
pub use notebook::{is_notebook_file, is_supported_file};

pub const APP_NAME: &str = "glyph";

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
    // Focus whatever window is current first, so a bare relaunch (no path) just
    // resurfaces the app.
    let current = windows_runtime::current_window_label(app_handle);
    windows_runtime::focus_window(app_handle, &current);

    if let Some(event) = cli::second_instance_event(&argv, &std::path::PathBuf::from(&cwd_str)) {
        let kind = if event.event_name == "open-folder" {
            windows::OpenKind::Folder
        } else {
            windows::OpenKind::File
        };
        if let Some(registry) = app_handle.try_state::<windows::WindowRegistry>() {
            windows_runtime::open_in_app(app_handle, &registry, kind, event.path, &current);
        }
    }
}

/// Handle a macOS `RunEvent::Opened`: classify each opened path, stash the first
/// supported one as the initial file/folder, and route it to a window. The stash
/// is the cold-start safety net — a launch that opens Glyph delivers this event
/// before the frontend has registered its `open-file` listener, so the emit inside
/// `open_in_app` is lost; the mount-time `get_initial_file` / `get_initial_folder`
/// query reads the stash instead. First supported path wins.
///
/// `pub` so it is exempt from dead-code warnings on non-macOS targets (same reason
/// `handle_second_instance` is pub), and testable under `MockRuntime` everywhere.
pub fn handle_opened_paths<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    paths: Vec<std::path::PathBuf>,
) {
    let Some(registry) = app_handle.try_state::<windows::WindowRegistry>() else {
        return;
    };
    let current = windows_runtime::current_window_label(app_handle);
    for path in paths {
        // `cli::classify_resolved_path` is the same classifier the CLI arg block
        // uses, so the file/folder gating and the non-markdown rejection stay in
        // lockstep. Routing decides whether to focus, adopt, or spawn a window.
        match cli::classify_resolved_path(&path) {
            Some(cli::InitialOpenAction::Folder(p)) => {
                if let Some(state) = app_handle.try_state::<commands::InitialFolder>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(p.clone());
                    }
                }
                windows_runtime::open_in_app(
                    app_handle,
                    &registry,
                    windows::OpenKind::Folder,
                    p,
                    &current,
                );
                break;
            }
            Some(cli::InitialOpenAction::File(p)) => {
                if let Some(state) = app_handle.try_state::<commands::InitialFile>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(p.clone());
                    }
                }
                windows_runtime::open_in_app(
                    app_handle,
                    &registry,
                    windows::OpenKind::File,
                    p,
                    &current,
                );
                break;
            }
            Some(cli::InitialOpenAction::RejectedUnsupported(p)) => {
                eprintln!("Refusing to open unsupported file type: {p}");
                // Keep scanning the list — the user may have selected a mix of
                // supported and unsupported files.
            }
            None => {}
        }
    }
}

/// Build a fresh `tauri::Builder` with the platform-conditional single-instance
/// plugin registered on Windows and Linux. macOS routes second launches via
/// `RunEvent::Opened`, so it gets a vanilla builder.
///
/// Debug builds skip the plugin everywhere: with it registered, `tauri dev`
/// silently forwards to any glyph.exe left over from an earlier session and
/// exits, which both kills the dev run and leaves stale code on screen.
///
/// Extracted from `run()` so the cfg-gated branches can be unit-tested without
/// actually starting the Tauri runtime.
pub fn make_app_builder() -> tauri::Builder<tauri::Wry> {
    #[cfg(all(not(debug_assertions), any(target_os = "linux", target_os = "windows")))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(handle_second_instance));

    #[cfg(not(all(not(debug_assertions), any(target_os = "linux", target_os = "windows"))))]
    let builder = tauri::Builder::default();

    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_app_builder()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // CLI args, window-state restoration, and the native menu bar only exist
    // on desktop; both plugins are desktop-only crates (see the Cargo.toml
    // target table).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_cli::init())
        .plugin(
            // Restore size/position/etc, but NOT visibility: the window is
            // created hidden (see tauri.conf.json) and revealed by the frontend
            // once it has painted, so the plugin must not re-show it early.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .on_menu_event(menu::handle_menu_event);

    let app = builder
        .manage(FileWatcherState(Arc::new(Mutex::new(
            std::collections::HashMap::new(),
        ))))
        .manage(commands::InitialFile(Mutex::new(None)))
        .manage(commands::InitialFolder(Mutex::new(None)))
        .manage(commands::CliExport(Mutex::new(None)))
        .manage(sync::SyncState::new())
        .manage(telemetry::TelemetryState(Mutex::new(None)))
        .manage(windows::WindowRegistry::new())
        .setup(|app| {
            // Mobile has no menu bar and no CLI: the main window simply starts
            // with no workspace, and the desktop-only block below compiles out.
            #[cfg(mobile)]
            app.state::<windows::WindowRegistry>()
                .set_workspace("main", None);

            #[cfg(desktop)]
            {
                let (menu, menu_refs) = menu::build_menu(app)?;
                app.set_menu(menu)?;
                // Start with everything disabled — the frontend reasserts state
                // as soon as it mounts and learns about the active tab and settings.
                let initial_flags = menu::MenuStateFlags {
                    has_tab: false,
                    has_file: false,
                    has_content: false,
                    has_workspace: false,
                    ai_configured: false,
                    tts_available: false,
                };
                let _ = menu::apply_menu_state(&menu_refs, &initial_flags);
                app.manage(menu_refs);

                // Parse CLI arguments and store the initial file/folder. The pure
                // selection + classification logic lives in `cli` (tested
                // there); this block is the thin Tauri-runtime adapter that maps
                // each variant to managed state or a warning.
                //
                // We pass both the `tauri-plugin-cli` value and raw `std::env::args()`
                // into `cli::initial_open_action`; the helper prefers the plugin
                // (so OS file-association launches still work) and falls back to
                // argv. The fallback is what makes `pnpm tauri dev -- samples`
                // work on Windows: pnpm's arg forwarding can land the positional
                // arg in argv without ever populating the plugin's matches.
                let cwd = std::env::current_dir().unwrap_or_default();
                let cli_matches = app.cli().matches().ok();
                let plugin_arg = |name: &str| -> Option<String> {
                    cli_matches
                        .as_ref()
                        .and_then(|m| m.args.get(name))
                        .and_then(|a| a.value.as_str().map(str::to_string))
                };
                let plugin_path = plugin_arg("file");
                let plugin_export = plugin_arg("export-website");
                let env_args: Vec<String> = std::env::args().collect();
                // Seed the window registry's "main" entry so routing knows what the
                // first window shows before its frontend reports back. A folder
                // launch pre-registers the workspace; everything else leaves main
                // empty (loose file / no document / headless export).
                let registry = app.state::<windows::WindowRegistry>();
                match cli::launch_plan(
                    plugin_path.as_deref(),
                    plugin_export.as_deref(),
                    &env_args,
                    &cwd,
                ) {
                    Err(usage) => {
                        eprintln!("{usage}");
                        std::process::exit(2);
                    }
                    Ok(cli::CliLaunch::ExportWebsite { root, out_dir }) => {
                        // Headless: the workspace is not opened in the UI and the
                        // window stays hidden; the frontend runs the export on
                        // mount and exits via `finish_cli_export`.
                        registry.set_workspace("main", None);
                        *app.state::<commands::CliExport>().0.lock().unwrap() =
                            Some(commands::export::CliExportRequest { root, out_dir });
                    }
                    Ok(cli::CliLaunch::Open(Some(cli::InitialOpenAction::Folder(p)))) => {
                        registry.set_workspace("main", Some(p.clone()));
                        *app.state::<commands::InitialFolder>().0.lock().unwrap() = Some(p);
                    }
                    Ok(cli::CliLaunch::Open(Some(cli::InitialOpenAction::File(p)))) => {
                        registry.set_workspace("main", None);
                        *app.state::<commands::InitialFile>().0.lock().unwrap() = Some(p);
                    }
                    Ok(cli::CliLaunch::Open(Some(
                        cli::InitialOpenAction::RejectedUnsupported(p),
                    ))) => {
                        registry.set_workspace("main", None);
                        eprintln!("Refusing to open unsupported file type: {p}");
                    }
                    Ok(cli::CliLaunch::Open(None)) => {
                        registry.set_workspace("main", None);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // A closed window leaves the routing registry so its workspace no
            // longer counts toward "is this folder already open".
            if matches!(event, WindowEvent::Destroyed) {
                if let Some(registry) = window.try_state::<windows::WindowRegistry>() {
                    registry.remove(window.label());
                }
            }
            // Drag and drop of folders or markdown files, routed the same way as
            // any other open request: a folder may spawn or focus a window, a
            // file opens as a loose tab in this window. First match wins.
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let app = window.app_handle();
                let Some(registry) = app.try_state::<windows::WindowRegistry>() else {
                    return;
                };
                let label = window.label().to_string();
                for path in paths {
                    let path_str = path.to_string_lossy().to_string();
                    if path.is_dir() {
                        windows_runtime::open_in_app(
                            app,
                            &registry,
                            windows::OpenKind::Folder,
                            path_str,
                            &label,
                        );
                        break;
                    }
                    if is_supported_file(path) {
                        windows_runtime::open_in_app(
                            app,
                            &registry,
                            windows::OpenKind::File,
                            path_str,
                            &label,
                        );
                        break;
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::write_binary_file,
            commands::file::create_dir_all,
            commands::file::copy_file,
            commands::file::get_file_metadata,
            commands::file::get_initial_file,
            commands::file::print_document,
            commands::export::get_cli_export,
            commands::export_runtime::finish_cli_export,
            commands::default_app::set_default_markdown_app,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::directory::get_initial_folder,
            commands::directory::read_directory,
            commands::directory::list_markdown_files,
            commands::create::create_note,
            commands::create::create_canvas,
            commands::create::create_folder,
            commands::create::rename_path,
            commands::create::duplicate_path,
            commands::create::move_path,
            commands::create::delete_path,
            commands::wikilinks::scan_wikilinks,
            commands::plugins::list_plugins,
            commands::plugins::install_plugin,
            commands::plugins::install_plugin_package,
            commands::plugins::read_plugin_asset,
            commands::plugins::uninstall_plugin,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::watch_directory,
            watcher::unwatch_directory,
            menu_runtime::set_menu_state,
            menu_runtime::apply_keybindings,
            menu_runtime::set_menu_labels,
            windows_runtime::set_window_workspace,
            windows_runtime::request_open,
            sync::commands::sync_set_config,
            sync::commands::sync_get_config,
            sync::commands::sync_remove_config,
            sync::commands::sync_set_token,
            sync::commands::sync_clear_token,
            sync::commands::sync_init_repo,
            sync::commands::sync_clone_remote,
            sync::commands::sync_set_origin,
            sync::commands::sync_commit_config,
            sync::commands::sync_status,
            sync::commands::sync_run,
            sync::commands::sync_default_author,
            sync::commands::sync_repo_present,
            workspace::commands::workspace_resolve,
            workspace::commands::workspace_get_last_file,
            workspace::commands::workspace_set_last_file,
            telemetry::set_error_reporting,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Glyph");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .collect();
            handle_opened_paths(_app_handle, paths);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::test::{mock_app, MockRuntime};
    use tauri::WebviewWindowBuilder;

    /// A mock app with a "main" window and a managed window registry, so
    /// `handle_second_instance`'s focus + routing path can run end to end.
    fn routed_app() -> tauri::App<MockRuntime> {
        let app = mock_app_with_main_window();
        app.manage(crate::windows::WindowRegistry::new());
        // The initial-file/folder state that `handle_opened_paths` stashes into
        // (the cold-start safety net) so tests can read the stash back.
        app.manage(commands::InitialFile(Mutex::new(None)));
        app.manage(commands::InitialFolder(Mutex::new(None)));
        app
    }

    fn stashed_file(app: &tauri::App<MockRuntime>) -> Option<String> {
        app.state::<commands::InitialFile>()
            .0
            .lock()
            .unwrap()
            .clone()
    }

    fn stashed_folder(app: &tauri::App<MockRuntime>) -> Option<String> {
        app.state::<commands::InitialFolder>()
            .0
            .lock()
            .unwrap()
            .clone()
    }

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

    // handle_second_instance is thin glue over `cli::second_instance_event`
    // (classification, tested in cli.rs) and `windows::route_open` (routing,
    // tested in windows.rs). Its own runtime effects (focus / emit_to / window
    // spawn) can't be observed under MockRuntime, so these tests assert it
    // drives that pipeline for each argv shape without panicking.
    #[test]
    fn handle_second_instance_routes_a_file_without_panicking() {
        let cwd = unique_tmp("hsi_file");
        fs::write(cwd.join("note.md"), "hi").unwrap();
        let app = routed_app();
        handle_second_instance(
            &app.handle().clone(),
            vec!["glyph".to_string(), "note.md".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_second_instance_routes_a_folder_without_panicking() {
        let cwd = unique_tmp("hsi_dir");
        fs::create_dir_all(cwd.join("workspace")).unwrap();
        let app = routed_app();
        handle_second_instance(
            &app.handle().clone(),
            vec!["glyph".to_string(), "workspace".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_second_instance_with_no_path_arg_only_focuses() {
        let cwd = unique_tmp("hsi_noop");
        let app = routed_app();
        handle_second_instance(
            &app.handle().clone(),
            vec!["glyph".to_string(), "--help".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_second_instance_silently_ignores_unresolvable_paths() {
        let cwd = unique_tmp("hsi_missing");
        let app = routed_app();
        handle_second_instance(
            &app.handle().clone(),
            vec!["glyph".to_string(), "nope.md".to_string()],
            cwd.to_string_lossy().to_string(),
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    // handle_opened_paths is the macOS file-association entry point. Its window
    // effects (focus / emit / spawn) can't be observed under MockRuntime, but the
    // cold-start stash into InitialFile / InitialFolder — the actual fix for
    // clicking a file while Glyph is closed — is managed state we can read back.
    #[test]
    fn handle_opened_paths_stashes_a_file_for_cold_start() {
        let cwd = unique_tmp("op_file");
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![file.clone()]);

        assert_eq!(
            stashed_file(&app).as_deref(),
            Some(file.to_string_lossy().as_ref())
        );
        assert_eq!(stashed_folder(&app), None);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_opened_paths_stashes_a_folder_for_cold_start() {
        let cwd = unique_tmp("op_folder");
        let folder = cwd.join("workspace");
        fs::create_dir_all(&folder).unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![folder.clone()]);

        assert_eq!(
            stashed_folder(&app).as_deref(),
            Some(folder.to_string_lossy().as_ref())
        );
        assert_eq!(stashed_file(&app), None);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_opened_paths_ignores_unsupported_files() {
        let cwd = unique_tmp("op_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>alert('x')</script>").unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![file]);

        assert_eq!(stashed_file(&app), None);
        assert_eq!(stashed_folder(&app), None);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_opened_paths_ignores_missing_paths() {
        let cwd = unique_tmp("op_missing");
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![cwd.join("nope.md")]);

        assert_eq!(stashed_file(&app), None);
        assert_eq!(stashed_folder(&app), None);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn make_app_builder_constructs_a_builder() {
        // We can't run the resulting builder (would start a real window
        // manager), but constructing it covers the cfg-gated plugin setup.
        let builder = make_app_builder();
        std::mem::drop(builder);
    }
}
