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

use crate::windows;
#[cfg(desktop)]
use crate::{cli, commands, grants, menu, stash_initial_open};

/// Runs inside Tauri's `setup` hook, before any window is shown.
pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
        let plugin_export = plugin_arg("export");
        let plugin_out = plugin_arg("out");
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
        match cli::launch_plan(
            plugin_path.as_deref(),
            plugin_export.as_deref(),
            plugin_out.as_deref(),
            &env_args,
            &cwd,
        ) {
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
