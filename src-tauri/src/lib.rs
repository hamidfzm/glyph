mod canvas;
mod cli;
#[cfg(desktop)]
mod cli_help;
mod commands;
mod d2;
#[cfg(desktop)]
mod data_dir;
mod extensions;
mod grants;
mod image;
mod launch_args;
mod markdown;
// `glyph mcp`, served before any Tauri builder exists.
#[cfg(desktop)]
mod mcp;
// Menus (tauri::menu), sync (git2), and telemetry (sentry) don't exist on
// mobile; their `generate_handler!` entries and managed state are gated too.
#[cfg(desktop)]
mod menu;
#[cfg(desktop)]
mod menu_runtime;
mod notebook;
mod secrets;
// The preview server behind `glyph serve`; desktop-only, like the CLI
// surface that reaches it.
#[cfg(desktop)]
mod serve;
mod setup;
mod sync;
#[cfg(desktop)]
mod telemetry;
mod vault;
mod watcher;
mod window_events;
mod windows;
mod windows_runtime;
mod workspace;

use setup::setup_app;
use std::sync::{Arc, Mutex};
use tauri::Manager;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::RunEvent;
use watcher::FileWatcherState;
use window_events::handle_window_event;

pub use canvas::is_canvas_file;
pub use d2::is_d2_file;
pub use image::is_image_file;
pub use markdown::is_markdown_file;
pub use notebook::{is_notebook_file, is_supported_file};

pub const APP_NAME: &str = "glyph";

/// Whether this build hands a launch over to a Glyph that is already running:
/// release builds on Windows and Linux, through the single-instance plugin.
/// macOS routes second launches via `RunEvent::Opened` instead.
///
/// Debug builds never do: with the plugin registered, `tauri dev` silently
/// forwards to any glyph.exe left over from an earlier session and exits,
/// which both kills the dev run and leaves stale code on screen.
#[cfg(desktop)]
const FORWARDS_LAUNCHES: bool = cfg!(all(
    not(debug_assertions),
    any(target_os = "linux", target_os = "windows")
));

/// Start this launch over with `args` as its whole argument list, so nothing
/// in the process can read the arguments that were dropped. The single-instance
/// plugin does (`std::env::args()`) when it forwards a launch, and would panic
/// before any valid path reached the running app. Returns only if the relaunch
/// could not start.
#[cfg(desktop)]
fn relaunch(args: &[String]) {
    let err = match std::env::current_exe() {
        Ok(exe) => hand_over_to(launch_args::relaunch_command(&exe, args)),
        Err(err) => err,
    };
    eprintln!("Could not relaunch without the ignored arguments: {err}");
}

#[cfg(all(desktop, unix))]
fn hand_over_to(mut command: std::process::Command) -> std::io::Error {
    use std::os::unix::process::CommandExt;
    // Replaces this process and keeps its pid, so whatever started Glyph is
    // still waiting on the right one.
    command.exec()
}

#[cfg(all(desktop, not(unix)))]
fn hand_over_to(mut command: std::process::Command) -> std::io::Error {
    match command.spawn() {
        // The child is the launch now. Only an open launch gets here, and
        // that has no exit status worth waiting for.
        Ok(_) => std::process::exit(0),
        Err(err) => err,
    }
}

/// Open what a launch named, the same way on every platform: a cold start, a
/// second instance and a macOS `Opened` event all come through here. Each
/// supported path opens as if it had been launched on its own, in the order
/// given (see [`windows::route_opens`]); each skipped one is reported and
/// never stops the rest. An open for a window whose frontend is not listening
/// yet waits in that window's queue.
pub(crate) fn open_launch<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    launch: cli::LaunchOpens,
) {
    for skipped in &launch.skipped {
        eprintln!("{skipped}");
    }
    let Some(registry) = app_handle.try_state::<windows::WindowRegistry>() else {
        return;
    };
    let current = windows_runtime::current_window_label(app_handle);
    windows_runtime::open_all_in_app(app_handle, &registry, launch.opens, &current);
}

/// Handle a second-instance launch: refocus the current window and open every
/// path the launch named in the running app.
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

    let launch = cli::launch_opens(&argv, std::path::Path::new(&cwd_str));
    open_launch(app_handle, launch);
}

/// Handle a macOS `RunEvent::Opened`, which carries every document selected in
/// Finder at once: open each supported one, under the same rules as a launch
/// that names several paths on Linux or Windows.
///
/// `pub` so it is exempt from dead-code warnings on non-macOS targets (same reason
/// `handle_second_instance` is pub), and testable under `MockRuntime` everywhere.
pub fn handle_opened_paths<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    paths: Vec<std::path::PathBuf>,
) {
    open_launch(app_handle, cli::opened_paths(&paths));
}

/// Build a fresh `tauri::Builder`, with the single-instance plugin registered
/// where this build forwards launches (see [`FORWARDS_LAUNCHES`]).
///
/// Extracted from `run()` so the cfg-gated branches can be unit-tested without
/// actually starting the Tauri runtime.
///
/// `forward_to_running_instance` is false for a CLI export: forwarding hands
/// the arguments to whatever Glyph the user already has open and exits 0, so
/// the export would silently never run.
pub fn make_app_builder(forward_to_running_instance: bool) -> tauri::Builder<tauri::Wry> {
    // The plugin crate only exists on these two targets; whether to use it is
    // the constant's call, so the relaunch in `run()` can never disagree.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    if FORWARDS_LAUNCHES && forward_to_running_instance {
        return tauri::Builder::default()
            .plugin(tauri_plugin_single_instance::init(handle_second_instance));
    }
    let _ = forward_to_running_instance;
    tauri::Builder::default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Read once, here: `std::env::args()` panics on an argument that is not
    // valid Unicode, which a file manager can hand over as a file name.
    let launch_args::LaunchArgs { args, dropped } = launch_args::split_unicode(std::env::args_os());
    for arg in &dropped {
        eprintln!(
            "Ignoring an argument that is not valid Unicode: {}",
            arg.to_string_lossy()
        );
    }

    // Answered before Tauri (and therefore GTK/WebKit) starts, so packaging
    // smoke tests can verify an installed binary headlessly.
    if args.iter().skip(1).any(|a| a == "--version" || a == "-V") {
        println!("glyph {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    #[cfg(desktop)]
    if cli_help::wants_help(&args) {
        println!("{}", cli_help::usage());
        return;
    }

    // An open launch goes on without the argument. A subcommand cannot: it
    // reads one path and its flag values by position, and with one of them
    // missing it would export or serve something the caller did not name.
    #[cfg(desktop)]
    if !dropped.is_empty() && cli::subcommand(&args).is_some() {
        eprintln!("A subcommand cannot run without it.");
        std::process::exit(2);
    }

    // `glyph mcp` answers on stdio for as long as its client keeps it open.
    // It never builds the app, so no window, webview or plugin exists, and
    // nothing but protocol messages reaches stdout.
    #[cfg(desktop)]
    if cli::subcommand(&args) == Some(cli::Subcommand::Mcp) {
        let cwd = std::env::current_dir().unwrap_or_default();
        let code = match cli::mcp_plan(&args, &cwd) {
            Ok(vaults) => {
                #[cfg(windows)]
                mcp::keep_stdio_from_children();
                mcp::run(
                    vaults,
                    None,
                    std::io::stdin().lock(),
                    std::io::stdout().lock(),
                )
            }
            Err(usage) => {
                eprintln!("{usage}");
                2
            }
        };
        std::process::exit(code);
    }

    // A subcommand does its work in this process, so it must not be
    // forwarded to a Glyph the user already has open.
    #[cfg(desktop)]
    let forward_to_running_instance = cli::forwards_to_running_instance(&args);
    #[cfg(not(desktop))]
    let forward_to_running_instance = true;

    // The single-instance plugin reads `std::env::args()` itself when it
    // forwards a launch, and would panic on what was dropped above.
    #[cfg(desktop)]
    if FORWARDS_LAUNCHES && forward_to_running_instance && !dropped.is_empty() {
        relaunch(&args);
    }

    let builder = make_app_builder(forward_to_running_instance)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Marketplace package downloads only; the URL scope lives in
        // capabilities/default.json.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // Window-state restoration, the native menu bar, sync, and telemetry only
    // exist on desktop (see the Cargo.toml target table).
    #[cfg(desktop)]
    let builder = builder
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
        .on_menu_event(menu::handle_menu_event)
        .manage(sync::SyncState::new())
        .manage(telemetry::TelemetryState(Mutex::new(None)));

    let app = builder
        .manage(FileWatcherState(Arc::new(Mutex::new(
            std::collections::HashMap::new(),
        ))))
        .manage(commands::CliExport(Mutex::new(None)))
        .manage(windows::WindowRegistry::new())
        .manage(grants::GrantRegistry::default())
        .manage(vault::VaultStore::default())
        .setup(move |app| setup_app(app, &args))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::write_binary_file,
            commands::file::create_dir_all,
            commands::file::copy_file,
            commands::file::prune_export_dir,
            commands::file::get_file_metadata,
            commands::file::allow_document_asset,
            #[cfg(desktop)]
            commands::file::print_document,
            #[cfg(desktop)]
            commands::pick::pick_folder,
            #[cfg(desktop)]
            commands::pick::pick_new_workspace,
            #[cfg(desktop)]
            commands::pick::pick_files,
            #[cfg(desktop)]
            commands::pick::pick_save,
            #[cfg(desktop)]
            commands::pick::pick_export_dir,
            #[cfg(desktop)]
            commands::pick::pick_plugin_dir,
            #[cfg(desktop)]
            commands::pick::pick_move_dir,
            commands::export::get_cli_export,
            commands::export_runtime::finish_cli_export,
            #[cfg(desktop)]
            commands::serve::get_cli_serve,
            #[cfg(desktop)]
            commands::serve::serve_ready,
            #[cfg(desktop)]
            commands::serve::serve_failed,
            commands::default_app::set_default_markdown_app,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_has,
            commands::directory::read_directory,
            commands::directory::list_markdown_files,
            commands::create::create_note,
            commands::create::create_canvas,
            commands::create::create_folder,
            commands::create::rename_path,
            commands::create::duplicate_path,
            commands::create::move_path,
            commands::create::delete_path,
            commands::create_file::create_workspace_file,
            vault::commands::vault_snapshot,
            vault::commands::vault_refresh,
            vault::commands::vault_forget,
            vault::commands::vault_backlinks,
            vault::commands::vault_resolve,
            vault::commands::vault_query,
            vault::commands::vault_paths_with_tag,
            commands::search::search_workspace,
            commands::plugins::list_plugins,
            commands::plugins::inspect_plugin,
            commands::plugins::install_plugin,
            commands::plugins::install_plugin_package,
            commands::plugins::read_plugin_asset,
            commands::plugins::uninstall_plugin,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::watch_directory,
            watcher::unwatch_directory,
            #[cfg(desktop)]
            menu_runtime::apply::set_menu_state,
            #[cfg(desktop)]
            menu_runtime::apply::apply_keybindings,
            #[cfg(desktop)]
            menu_runtime::apply::set_menu_labels,
            #[cfg(desktop)]
            menu_runtime::apply::set_overlay_fullscreen,
            #[cfg(desktop)]
            menu_runtime::apply::set_plugin_menu_items,
            windows_runtime::take_pending_opens,
            windows_runtime::set_window_workspace,
            windows_runtime::set_window_files,
            windows_runtime::set_window_unsaved,
            windows_runtime::request_open,
            windows_runtime::open_in_new_window,
            windows_runtime::window_showing_file,
            #[cfg(desktop)]
            sync::commands::sync_set_config,
            #[cfg(desktop)]
            sync::commands::sync_get_config,
            #[cfg(desktop)]
            sync::commands::sync_remove_config,
            #[cfg(desktop)]
            sync::commands::sync_set_token,
            #[cfg(desktop)]
            sync::commands::sync_clear_token,
            #[cfg(desktop)]
            sync::commands::sync_has_token,
            #[cfg(desktop)]
            sync::commands::sync_init_repo,
            #[cfg(desktop)]
            sync::commands::sync_clone_remote,
            #[cfg(desktop)]
            sync::commands::sync_set_origin,
            #[cfg(desktop)]
            sync::commands::sync_commit_config,
            #[cfg(desktop)]
            sync::commands::sync_status,
            #[cfg(desktop)]
            sync::commands::sync_run,
            #[cfg(desktop)]
            sync::commands::sync_default_author,
            #[cfg(desktop)]
            sync::commands::sync_repo_present,
            workspace::commands::workspace_resolve,
            workspace::commands::workspace_get_last_file,
            workspace::commands::workspace_set_last_file,
            workspace::commands::workspace_get_plugin_settings,
            workspace::commands::workspace_set_plugin_settings,
            #[cfg(desktop)]
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
        // Windows only: after the event loop is torn down, a late Win32 message
        // reaching tao's runner panics outside any catch_unwind, which aborts
        // the process on exit (tauri-apps/tao#1180). Plugin `on_event` handlers
        // (window state, stores) run before this callback, so everything that
        // must persist is already written by the time `Exit` arrives.
        #[cfg(target_os = "windows")]
        if matches!(_event, RunEvent::Exit) {
            telemetry::flush();
            std::process::exit(0);
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

    /// A mock app with a "main" window and the registries a launch runs
    /// through. The mock window's frontend never mounts, so this is the
    /// pre-mount case: every open routed to "main" waits in its queue.
    fn routed_app() -> tauri::App<MockRuntime> {
        let app = mock_app_with_main_window();
        app.manage(crate::windows::WindowRegistry::new());
        app.manage(crate::grants::GrantRegistry::default());
        app
    }

    /// Drain what launches queued for "main", the way its frontend does once
    /// its listeners are attached.
    fn drain_main(app: &tauri::App<MockRuntime>) -> Vec<(windows::OpenKind, PathBuf)> {
        app.state::<windows::WindowRegistry>()
            .take_pending("main")
            .into_iter()
            .map(|open| (open.kind, PathBuf::from(open.path)))
            .collect()
    }

    fn second_instance(app: &tauri::App<MockRuntime>, cwd: &std::path::Path, args: &[&str]) {
        let argv = std::iter::once("glyph")
            .chain(args.iter().copied())
            .map(String::from)
            .collect();
        handle_second_instance(
            &app.handle().clone(),
            argv,
            cwd.to_string_lossy().to_string(),
        );
    }

    /// A launch argument is canonicalized before it is opened.
    fn file_open(path: &std::path::Path) -> (windows::OpenKind, PathBuf) {
        (windows::OpenKind::File, path.canonicalize().unwrap())
    }

    fn folder_open(path: &std::path::Path) -> (windows::OpenKind, PathBuf) {
        (windows::OpenKind::Folder, path.canonicalize().unwrap())
    }

    fn can_read(app: &tauri::App<MockRuntime>, path: &std::path::Path) -> bool {
        app.state::<crate::grants::GrantRegistry>()
            .ensure_readable(path.to_string_lossy().as_ref())
            .is_ok()
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

    // handle_second_instance is thin glue over `cli::launch_opens`
    // (classification, tested in cli.rs) and `windows::route_opens` (routing,
    // tested in windows/tests.rs). Its runtime effects (focus / emit_to /
    // window spawn) can't be observed under MockRuntime, but the queue of a
    // window that is not listening yet can: it is what carries a launch that
    // fires before the first instance's webview has attached its open-file /
    // open-folder listeners, when an emit alone would be lost.
    #[test]
    fn a_second_instance_queues_its_file_for_a_window_that_has_not_mounted() {
        let cwd = unique_tmp("hsi_file");
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();
        let app = routed_app();

        second_instance(&app, &cwd, &["note.md"]);

        assert_eq!(drain_main(&app), vec![file_open(&file)]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_second_instance_queues_its_folder_and_claims_the_window_for_it() {
        let cwd = unique_tmp("hsi_dir");
        let folder = cwd.join("workspace");
        fs::create_dir_all(&folder).unwrap();
        let app = routed_app();

        second_instance(&app, &cwd, &["workspace"]);

        // Claimed before the frontend can report it, so a second folder
        // launched in the same moments opens a window instead of replacing it.
        let claimed = folder.canonicalize().unwrap();
        assert_eq!(
            app.state::<windows::WindowRegistry>().snapshot().workspaces,
            vec![(
                "main".to_string(),
                Some(claimed.to_string_lossy().to_string())
            )]
        );
        assert_eq!(drain_main(&app), vec![folder_open(&folder)]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_second_instance_opens_every_supported_file_it_names() {
        // `Exec=glyph %F` with three files selected, handed to a running Glyph.
        let cwd = unique_tmp("hsi_many");
        let names = ["a.md", "b.md", "c.md"];
        for name in names {
            fs::write(cwd.join(name), "hi").unwrap();
        }
        let app = routed_app();

        second_instance(&app, &cwd, &names);

        let expected: Vec<_> = names
            .iter()
            .map(|name| file_open(&cwd.join(name)))
            .collect();
        assert_eq!(drain_main(&app), expected);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn an_unsupported_or_missing_path_does_not_stop_the_rest_and_is_never_granted() {
        let cwd = unique_tmp("hsi_mixed");
        let text = cwd.join("notes.txt");
        fs::write(&text, "<script>alert('x')</script>").unwrap();
        let a = cwd.join("a.md");
        let b = cwd.join("b.md");
        fs::write(&a, "hi").unwrap();
        fs::write(&b, "hi").unwrap();
        let app = routed_app();

        second_instance(&app, &cwd, &["notes.txt", "a.md", "nope.md", "b.md"]);

        assert_eq!(drain_main(&app), vec![file_open(&a), file_open(&b)]);
        assert!(can_read(&app, &a) && can_read(&app, &b));
        assert!(!can_read(&app, &text), "a skipped path must stay denied");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_path_named_twice_in_one_launch_opens_once() {
        let cwd = unique_tmp("hsi_dupes");
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();
        let app = routed_app();

        let absolute = file.to_string_lossy();
        second_instance(&app, &cwd, &["note.md", "./note.md", &*absolute]);

        assert_eq!(drain_main(&app), vec![file_open(&file)]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_folder_among_files_opens_as_the_workspace_beside_them() {
        let cwd = unique_tmp("hsi_folder_files");
        let folder = cwd.join("workspace");
        fs::create_dir_all(&folder).unwrap();
        let a = cwd.join("a.md");
        let b = cwd.join("b.md");
        fs::write(&a, "hi").unwrap();
        fs::write(&b, "hi").unwrap();
        let app = routed_app();

        second_instance(&app, &cwd, &["a.md", "workspace", "b.md"]);

        assert_eq!(
            drain_main(&app),
            vec![file_open(&a), folder_open(&folder), file_open(&b)]
        );
        let grants = app.state::<crate::grants::GrantRegistry>();
        assert!(grants
            .ensure_workspace(folder.to_string_lossy().as_ref())
            .is_ok());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launches_arriving_before_the_window_mounts_all_survive_in_order() {
        // The single stash slot kept only the last of these.
        let cwd = unique_tmp("hsi_two_launches");
        let a = cwd.join("a.md");
        let b = cwd.join("b.md");
        let c = cwd.join("c.md");
        for file in [&a, &b, &c] {
            fs::write(file, "hi").unwrap();
        }
        let app = routed_app();

        second_instance(&app, &cwd, &["a.md"]);
        second_instance(&app, &cwd, &["b.md", "c.md"]);

        assert_eq!(
            drain_main(&app),
            vec![file_open(&a), file_open(&b), file_open(&c)]
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_launch_for_a_mounted_window_is_nudged_and_handed_over_once_in_order() {
        use tauri::Listener;

        let cwd = unique_tmp("hsi_live");
        let names = ["a.md", "b.md", "c.md"];
        for name in names {
            fs::write(cwd.join(name), "hi").unwrap();
        }
        let app = routed_app();
        // The window's frontend has mounted and taken its (empty) queue.
        drain_main(&app);
        let nudges = Arc::new(Mutex::new(0));
        let counter = nudges.clone();
        app.listen_any("opens-pending", move |_| {
            *counter.lock().unwrap() += 1;
        });

        second_instance(&app, &cwd, &names);

        // The event carries no path, so a window that misses it (a reload)
        // loses nothing: the paths wait for its next take.
        assert!(*nudges.lock().unwrap() > 0, "the window must be nudged");
        let expected: Vec<_> = names
            .iter()
            .map(|name| file_open(&cwd.join(name)))
            .collect();
        assert_eq!(drain_main(&app), expected);
        // A later mount asking again must not get this launch's files back.
        assert!(drain_main(&app).is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_second_instance_with_no_path_arg_only_focuses() {
        let cwd = unique_tmp("hsi_noop");
        let app = routed_app();

        second_instance(&app, &cwd, &["--help"]);

        assert!(drain_main(&app).is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_second_instance_naming_only_unresolvable_paths_opens_nothing() {
        let cwd = unique_tmp("hsi_missing");
        let app = routed_app();

        second_instance(&app, &cwd, &["nope.md"]);

        assert!(drain_main(&app).is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    // handle_opened_paths is the macOS file-association entry point. Its window
    // effects (focus / emit / spawn) can't be observed under MockRuntime, but the
    // queue is: clicking files while Glyph is closed delivers this event before
    // the frontend is listening, and the queue is what carries them to it. The
    // OS hands these paths over already resolved, so they are opened as given.
    #[test]
    fn opened_paths_queue_a_file_for_cold_start() {
        let cwd = unique_tmp("op_file");
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![file.clone()]);

        assert_eq!(drain_main(&app), vec![(windows::OpenKind::File, file)]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn opened_paths_queue_a_folder_for_cold_start() {
        let cwd = unique_tmp("op_folder");
        let folder = cwd.join("workspace");
        fs::create_dir_all(&folder).unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![folder.clone()]);

        assert_eq!(drain_main(&app), vec![(windows::OpenKind::Folder, folder)]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn opened_paths_open_every_supported_document_like_a_multi_file_launch() {
        // Finder hands every selected document to one event. The platforms
        // agree: the unsupported one is skipped, the rest all open, in order.
        let cwd = unique_tmp("op_many");
        let text = cwd.join("evil.txt");
        fs::write(&text, "<script>alert('x')</script>").unwrap();
        let a = cwd.join("a.md");
        let b = cwd.join("b.md");
        fs::write(&a, "hi").unwrap();
        fs::write(&b, "hi").unwrap();
        let app = routed_app();

        handle_opened_paths(
            &app.handle().clone(),
            vec![
                text.clone(),
                a.clone(),
                cwd.join("gone.md"),
                b.clone(),
                a.clone(),
            ],
        );

        assert_eq!(
            drain_main(&app),
            vec![
                (windows::OpenKind::File, a.clone()),
                (windows::OpenKind::File, b.clone())
            ]
        );
        assert!(can_read(&app, &a) && can_read(&app, &b));
        assert!(!can_read(&app, &text), "a skipped path must stay denied");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn handle_opened_paths_mints_grants_for_routed_paths() {
        let cwd = unique_tmp("op_grants");
        let folder = cwd.join("workspace");
        fs::create_dir_all(&folder).unwrap();
        let file = cwd.join("note.md");
        fs::write(&file, "hi").unwrap();

        let app = routed_app();
        handle_opened_paths(&app.handle().clone(), vec![folder.clone()]);
        let app2 = routed_app();
        handle_opened_paths(&app2.handle().clone(), vec![file.clone()]);

        let grants = app.state::<crate::grants::GrantRegistry>();
        assert!(grants
            .ensure_workspace(folder.to_string_lossy().as_ref())
            .is_ok());
        let grants2 = app2.state::<crate::grants::GrantRegistry>();
        assert!(grants2
            .ensure_readable(file.to_string_lossy().as_ref())
            .is_ok());
        // The other app never saw the file, so it stays denied there.
        assert!(grants
            .ensure_readable(file.to_string_lossy().as_ref())
            .is_err());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn opened_paths_that_are_unsupported_or_missing_open_nothing() {
        let cwd = unique_tmp("op_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>alert('x')</script>").unwrap();
        let app = routed_app();

        handle_opened_paths(&app.handle().clone(), vec![file, cwd.join("nope.md")]);

        assert!(drain_main(&app).is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn make_app_builder_constructs_a_builder_either_way() {
        // We can't run the resulting builder (would start a real window
        // manager), but constructing it covers the cfg-gated plugin setup.
        // An export passes false so the launch is never forwarded to a Glyph
        // the user already has open, which would skip the export entirely.
        std::mem::drop(make_app_builder(true));
        std::mem::drop(make_app_builder(false));
    }

    // Each (directive, source) pair backs a shipped surface: WASM for
    // Mermaid/D2, blob/data scripts for the plugin worker sandbox, eval for
    // the D2 blob worker's `new Function` ELK loader (WebKit enforces the page
    // CSP inside blob workers, so without it D2 never renders there), remote
    // schemes for document-embedded images/media, https for AI providers and
    // the marketplace, inline styles for theme injection.
    // Spawned secondary windows for a second folder are labelled `w1`, `w2`, …
    // (windows::WindowRegistry::next_label). The capability files must apply to
    // them as well as `main`, or a spawned window gets zero permissions once it
    // loads (no store, dialog, or IPC events).
    #[test]
    fn capabilities_apply_to_spawned_windows() {
        for capability in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/desktop.json"),
            include_str!("../capabilities/mobile.json"),
        ] {
            let conf: serde_json::Value = serde_json::from_str(capability).unwrap();
            let windows: Vec<&str> = conf["windows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|w| w.as_str().unwrap())
                .collect();
            assert!(windows.contains(&"main"), "capability must cover main");
            assert!(
                windows.contains(&"w*"),
                "capability must cover spawned `w*` windows, got {windows:?}"
            );
        }
    }

    // useWindowClose intercepts close-requested, then re-issues close(); the
    // @tauri-apps/api wrapper finishes the un-prevented pass with destroy().
    // Missing any of these permissions leaves every window un-closable (#530).
    #[test]
    fn close_pipeline_permissions_are_granted() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let perms: Vec<&str> = conf["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for perm in [
            "core:window:allow-show",
            "core:window:allow-set-focus",
            "core:window:allow-close",
            "core:window:allow-destroy",
        ] {
            assert!(perms.contains(&perm), "default capability must keep {perm}");
        }
    }

    /// The fs plugin's `scope-app-recursive` scope, which `fs:default` pulls
    /// in, is unioned across every fs command, reads and writes alike. Granting
    /// any fs permission to the default capability therefore hands the webview
    /// write access to `$APPCONFIG`, which is where plugins are installed
    /// (`commands/plugins/mod.rs`), so a compromised renderer could persist
    /// code across restarts. Desktop routes every filesystem call through
    /// `GrantRegistry` instead; the fs plugin belongs to the mobile-only
    /// capability (#698).
    #[test]
    fn default_capability_grants_no_filesystem_plugin_access() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        for permission in conf["permissions"].as_array().unwrap() {
            let identifier = permission
                .as_str()
                .or_else(|| permission["identifier"].as_str())
                .expect("every permission is a string or an object with an identifier");
            assert!(
                !identifier.starts_with("fs:"),
                "default capability must not grant {identifier}: the fs plugin is mobile-only"
            );
        }
    }

    /// Mobile keeps the fs read path because Android pickers return
    /// `content://` URIs that the Rust commands cannot open, but it must stay
    /// fenced off desktop and must never gain a write permission.
    #[test]
    fn mobile_capability_keeps_reads_only() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/mobile.json")).unwrap();
        let platforms: Vec<&str> = conf["platforms"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        assert_eq!(platforms, ["android", "iOS"]);
        let perms: Vec<&str> = conf["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        assert!(perms.contains(&"fs:allow-read-text-file"));
        assert!(
            !perms.iter().any(|p| p.contains("write")),
            "mobile capability must not gain fs write access"
        );
    }

    #[test]
    fn csp_keeps_every_surface_the_app_depends_on() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let sec = &conf["app"]["security"];
        for key in ["csp", "devCsp"] {
            let csp = sec[key].as_str().unwrap();
            for (directive, source) in [
                ("script-src", "'wasm-unsafe-eval'"),
                ("script-src", "'unsafe-eval'"),
                ("script-src", "blob:"),
                ("script-src", "data:"),
                ("img-src", "https:"),
                ("img-src", "http:"),
                ("img-src", "asset:"),
                ("img-src", "data:"),
                ("img-src", "blob:"),
                ("media-src", "https:"),
                ("connect-src", "https:"),
                ("connect-src", "ipc:"),
                ("style-src", "'unsafe-inline'"),
                ("font-src", "data:"),
            ] {
                let value = csp
                    .split(';')
                    .find(|d| d.trim_start().starts_with(directive))
                    .unwrap_or_else(|| panic!("{key} is missing {directive}"));
                assert!(
                    value.contains(source),
                    "{key}: {directive} must keep {source}"
                );
            }
            assert!(
                csp.contains("object-src 'none'"),
                "{key} must keep object-src 'none'"
            );
            assert!(
                csp.contains("frame-src 'none'"),
                "{key} must keep frame-src 'none'"
            );
        }
        let allow = sec["assetProtocol"]["scope"]["allow"].as_array().unwrap();
        assert!(allow.is_empty(), "asset scope must stay empty at rest");
    }
}
