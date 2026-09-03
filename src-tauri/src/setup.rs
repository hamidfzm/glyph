//! One-time application setup: the native menu, CLI-argument routing, and the
//! grants seeded from the persisted settings store. Split out of `run()` in
//! lib.rs, which is otherwise plugin registration and the command table.
//!
//! Every line here drives the Tauri runtime (`App`, `AppHandle`, the CLI
//! plugin), so it cannot be exercised from a `MockRuntime` test; the pure
//! selection and classification logic it calls lives in [`crate::cli`] and is
//! tested there.

// `Manager` is not desktop-only: the registry seeding below runs on every
// platform, and `state()` comes from that trait.
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_cli::CliExt;
use tauri_plugin_store::StoreExt;

use crate::windows;
#[cfg(desktop)]
use crate::{cli, commands, grants, menu, stash_initial_open};

/// Renderer-facing stores, opened here because the renderer holds no
/// `store:allow-load` (see docs/security/threat-model.md). The session store
/// batches its writes and saves explicitly, so it opts out of the builder's
/// default debounced auto-save.
const STORES: [(&str, bool); 3] = [
    ("settings.json", true),
    ("plugins.json", true),
    ("workspace-sessions.json", false),
];

/// Runs inside Tauri's `setup` hook, before any window is shown.
pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    for (file, auto_save) in STORES {
        let mut builder = app.store_builder(file);
        if !auto_save {
            builder = builder.disable_auto_save();
        }
        // A corrupt file leaves that store unopened; the renderer then falls
        // back to defaults, exactly as it did when its own `load` failed.
        if let Err(err) = builder.build() {
            eprintln!("failed to open {file}: {err}");
        }
    }

    // Seed the registry's "main" entry so routing knows what the first
    // window shows; a desktop folder launch overrides it below.
    app.state::<windows::WindowRegistry>()
        .set_workspace("main", None);

    #[cfg(desktop)]
    {
        // Windows uses per-window menus with owner-prefixed item ids
        // (see build_menu); other platforms share one app menu.
        #[cfg(windows)]
        let menu_owner = Some("main");
        #[cfg(not(windows))]
        let menu_owner = None;
        let (menu, menu_refs) = menu::build_menu(app.handle(), menu_owner)?;
        app.set_menu(menu)?;
        // Start with everything disabled; the frontend reasserts state
        // as soon as it mounts and learns about the active tab and settings.
        let _ = menu::apply_menu_state(&menu_refs, &menu::MenuStateFlags::default());
        app.manage(menu::MenuRegistry::with_main(menu_refs));

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
        let env_args: Vec<String> = std::env::args().collect();
        // Session restore and the recent-files menu re-open paths from
        // earlier sessions; seed their grants from the persisted settings
        // store (AppData, with AppConfig as the Linux fallback spelling).
        {
            let grant_registry = app.state::<grants::GrantRegistry>();
            let handle = app.handle();
            for base in [
                handle.path().app_data_dir().ok(),
                handle.path().app_config_dir().ok(),
            ]
            .into_iter()
            .flatten()
            {
                let Ok(raw) = std::fs::read_to_string(base.join("settings.json")) else {
                    continue;
                };
                let (workspaces, files) = grant_registry.seed_from_settings_json(&raw);
                for dir in &workspaces {
                    grants::allow_asset_dir(handle, dir);
                }
                for file in &files {
                    grants::allow_asset_file(handle, file);
                }
                break;
            }
        }
        let grant_registry = app.state::<grants::GrantRegistry>();
        match cli::launch_plan(plugin_path.as_deref(), &env_args, &cwd) {
            Err(usage) => {
                eprintln!("{usage}");
                std::process::exit(2);
            }
            Ok(cli::CliLaunch::Export {
                input,
                format,
                output,
            }) => {
                // Headless: the window stays hidden and the frontend runs the
                // export on mount, then exits via `finish_cli_export`. A site
                // export renders the workspace straight from disk; a document
                // export reads the rendered DOM, so its input is also stashed
                // as the initial file for the hidden window to open.
                if format == cli::ExportFormat::Site {
                    let _ = grant_registry.grant_workspace(std::path::Path::new(&input));
                    // A site is a tree of files, so the whole output directory
                    // is writable; a document gets an exact-path grant instead,
                    // the same one the interactive save dialog mints.
                    let _ = grant_registry.grant_export_dir(std::path::Path::new(&output));
                } else {
                    let _ = grant_registry.grant_export_file(std::path::Path::new(&output));
                    if let Ok(canonical) = grant_registry.grant_file(std::path::Path::new(&input)) {
                        grants::allow_asset_file(app.handle(), &canonical);
                    }
                    stash_initial_open(app.handle(), windows::OpenKind::File, &input);
                }
                *app.state::<commands::CliExport>().0.lock().unwrap() =
                    Some(commands::export::CliExportRequest {
                        input,
                        format: format.as_str().to_string(),
                        output,
                    });
            }
            Ok(cli::CliLaunch::Serve {
                root,
                host,
                port,
                output,
            }) => {
                // Like a site export, the window stays hidden and the
                // frontend renders on mount. Unlike one, the process then
                // stays up: the server keeps answering and every change
                // renders again.
                if let Err(message) = start_serve(app.handle(), &root, host, port, output) {
                    eprintln!("{message}");
                    std::process::exit(1);
                }
            }
            Ok(cli::CliLaunch::Open(Some(cli::InitialOpenAction::Folder(p)))) => {
                if let Ok(canonical) = grant_registry.grant_workspace(std::path::Path::new(&p)) {
                    grants::allow_asset_dir(app.handle(), &canonical);
                }
                app.state::<windows::WindowRegistry>()
                    .set_workspace("main", Some(p.clone()));
                stash_initial_open(app.handle(), windows::OpenKind::Folder, &p);
            }
            Ok(cli::CliLaunch::Open(Some(cli::InitialOpenAction::File(p)))) => {
                if let Ok(canonical) = grant_registry.grant_file(std::path::Path::new(&p)) {
                    grants::allow_asset_file(app.handle(), &canonical);
                }
                stash_initial_open(app.handle(), windows::OpenKind::File, &p);
            }
            Ok(cli::CliLaunch::Open(Some(cli::InitialOpenAction::RejectedUnsupported(p)))) => {
                eprintln!("Refusing to open unsupported file type: {p}");
            }
            Ok(cli::CliLaunch::Open(None)) => {}
        }
    }
    Ok(())
}

/// Where a `glyph serve` with no `--out` puts the site.
///
/// Created through `tempfile` rather than at a name derived from the process
/// id: the system temp directory is world-writable on Unix and process ids
/// are guessable, so a predictable name can be pre-created (or pointed
/// somewhere else by a symlink) by any local user, who would then be choosing
/// the HTML the victim's browser is about to load from localhost. `tempfile`
/// creates it with a random name and owner-only permissions.
///
/// The directory outlives the handle on purpose. Removal happens on interrupt
/// in [`spawn_temp_dir_cleanup`], because the process ends without unwinding
/// and `Drop` would never run.
#[cfg(desktop)]
fn default_serve_dir() -> Result<std::path::PathBuf, String> {
    tempfile::Builder::new()
        .prefix("glyph-serve-")
        .tempdir()
        .map(tempfile::TempDir::keep)
        .map_err(|err| format!("cannot create a temporary directory to serve from: {err}"))
}

/// Bring up everything `glyph serve` needs before the frontend renders:
/// the output directory, the grants the export writes through, the bound
/// socket, the file watch, and the state the two sides share.
///
/// Binding happens here rather than in the server task so that a port
/// already in use fails immediately, with the process exiting nonzero rather
/// than sitting there having served nothing.
#[cfg(desktop)]
fn start_serve(
    app: &tauri::AppHandle,
    root: &str,
    host: std::net::IpAddr,
    port: u16,
    output: Option<String>,
) -> Result<(), String> {
    let owns_output = output.is_none();
    let out_dir = match output {
        Some(path) => {
            let path = std::path::PathBuf::from(path);
            std::fs::create_dir_all(&path)
                .map_err(|err| format!("cannot create the output directory {path:?}: {err}"))?;
            path
        }
        None => default_serve_dir()?,
    };

    let grant_registry = app.state::<grants::GrantRegistry>();
    let _ = grant_registry.grant_workspace(std::path::Path::new(root));
    let _ = grant_registry.grant_export_dir(&out_dir);

    let listener = std::net::TcpListener::bind((host, port))
        .map_err(|err| format!("cannot serve on {host}:{port}: {err}"))?;
    let address = listener
        .local_addr()
        .map_err(|err| format!("cannot read the bound address: {err}"))?;
    // tokio requires a nonblocking socket. Doing it here, rather than inside
    // the server task, keeps an unusable socket a startup failure with a
    // nonzero exit instead of a log line under a ready message.
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("cannot serve on {address}: {err}"))?;

    if !host.is_loopback() {
        eprintln!(
            "Warning: serving on {host} exposes {} to the network. Anyone who can reach this machine can read the whole folder.",
            cli::plain_path(root)
        );
    }

    let (reload, _) = tokio::sync::broadcast::channel(16);
    app.manage(commands::serve::ServeState::new(
        commands::serve::CliServeRequest {
            root: root.to_string(),
            out_dir: out_dir.to_string_lossy().to_string(),
        },
        cli::plain_path(root),
        format!("http://{address}"),
        reload.clone(),
    ));

    // The watcher stops the moment it is dropped, and nothing else owns it,
    // so it lives in managed state for as long as the process does.
    match crate::serve::watch::watch(app.clone(), std::path::Path::new(root)) {
        Ok(watcher) => {
            app.manage(commands::serve::ServeWatcher {
                _watcher: std::sync::Mutex::new(watcher),
            });
        }
        Err(err) => eprintln!("Warning: changes to {root} will not rebuild the site: {err}"),
    }

    let served = out_dir.clone();
    let guard = crate::serve::HostGuard::new(host);
    tauri::async_runtime::spawn(async move {
        // Registering with the reactor needs a runtime, so it happens here
        // rather than beside the bind above.
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => crate::serve::run(listener, served, guard, reload).await,
            Err(err) => eprintln!("glyph serve: cannot use the bound socket: {err}"),
        }
    });

    if owns_output {
        spawn_temp_dir_cleanup(out_dir);
    }
    Ok(())
}

/// Remove the temporary site on the way out. `Drop` never runs here: the
/// process ends either through `std::process::exit` or through the interrupt
/// that a foreground server is normally stopped with, and neither unwinds.
#[cfg(desktop)]
fn spawn_temp_dir_cleanup(dir: std::path::PathBuf) {
    tauri::async_runtime::spawn(async move {
        // Only exit on an actual interrupt. Exiting when the handler cannot
        // be registered would end a healthy server moments after startup,
        // reporting success and explaining nothing.
        match tokio::signal::ctrl_c().await {
            Ok(()) => {
                let _ = std::fs::remove_dir_all(&dir);
                std::process::exit(0);
            }
            Err(err) => {
                eprintln!(
                    "glyph serve: cannot listen for interrupts, so {dir:?} will be left behind: {err}"
                );
            }
        }
    });
}
