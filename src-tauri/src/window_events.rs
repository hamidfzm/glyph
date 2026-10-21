//! Per-window Tauri events: teardown of the routing registries and drag-drop
//! of folders/files onto a window. Runtime-bound glue, so it lives beside
//! `setup.rs` rather than inside `run()`.

use tauri::{DragDropEvent, Manager, Runtime, Window, WindowEvent};

#[cfg(desktop)]
use crate::menu;
use crate::{is_supported_file, windows, windows_runtime};

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    // A closed window leaves the routing registry so its workspace and files no
    // longer count toward "is this already open", and releases the watches it
    // owned on the way out.
    if matches!(event, WindowEvent::Destroyed) {
        if let Some(registry) = window.try_state::<windows::WindowRegistry>() {
            let label = window.label();
            let owned = registry.exclusively_owned_paths(label);
            crate::watcher::drop_watches(window.app_handle(), &owned);
            // The index outlives its watches otherwise, holding every note's
            // tags, fields and links for the rest of the session.
            if let Some(store) = window.try_state::<crate::vault::VaultStore>() {
                for path in &owned {
                    crate::vault::forget(&store, path);
                }
            }
            windows_runtime::forget_window(window.app_handle(), &registry, label);
        }
        #[cfg(desktop)]
        if let Some(menus) = window.try_state::<menu::MenuRegistry<R>>() {
            menus.remove(window.label());
        }
    }
    // Drag and drop of folders or markdown files, routed the same way as
    // any other open request: a folder may spawn or focus a window, a
    // file opens as a loose tab in this window. First match wins.
    if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
        let app = window.app_handle();
        let (Some(registry), Some(sources)) = (
            app.try_state::<windows::WindowRegistry>(),
            app.try_state::<windows::DragSources>(),
        ) else {
            return;
        };
        let label = window.label().to_string();
        // A drag the page started comes back to this window as a drop of
        // whatever paths the page wrote, so it names renderer paths and
        // grants nothing (see windows/drag_source.rs).
        if !sources.accepts_drop(&label) {
            #[cfg(debug_assertions)]
            eprintln!("Ignoring a drop on window {label}: the drag began in this app.");
            return;
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grants::GrantRegistry;
    use crate::windows::{DragSources, OpenKind, WindowRegistry};
    use std::path::PathBuf;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::{PhysicalPosition, WebviewWindowBuilder};

    /// A mock app with a "main" window and the state the drop handler reads.
    /// The mock window's frontend never mounts, so an open routed to it waits
    /// in its queue, where the test can see it.
    fn app_with_main() -> (tauri::App<MockRuntime>, Window<MockRuntime>) {
        let app = mock_app();
        let webview_window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        let webview: &tauri::Webview<MockRuntime> = webview_window.as_ref();
        let window = webview.window();
        app.manage(WindowRegistry::new());
        app.manage(GrantRegistry::default());
        app.manage(DragSources::default());
        (app, window)
    }

    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_window_events_{}_{}",
            name,
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn drop_of(paths: Vec<PathBuf>) -> WindowEvent {
        WindowEvent::DragDrop(DragDropEvent::Drop {
            paths,
            position: PhysicalPosition::new(0.0, 0.0),
        })
    }

    #[test]
    fn a_folder_dropped_from_outside_is_granted_and_routed() {
        let dir = unique_tmp("outside");
        let (app, window) = app_with_main();

        handle_window_event(&window, &drop_of(vec![dir.clone()]));

        let grants = app.state::<GrantRegistry>();
        assert!(grants.ensure_workspace(&dir.to_string_lossy()).is_ok());
        let queued = app.state::<WindowRegistry>().take_pending("main");
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].kind, OpenKind::Folder);
        assert_eq!(PathBuf::from(&queued[0].path), dir);
    }

    #[test]
    fn a_drop_of_a_drag_this_window_started_grants_nothing() {
        // The page wrote this path into its own drag; honouring the drop
        // would let the renderer mint a workspace grant for any folder.
        let dir = unique_tmp("own_drag");
        let (app, window) = app_with_main();
        app.state::<DragSources>().record("main", true);

        handle_window_event(&window, &drop_of(vec![dir.clone()]));

        let grants = app.state::<GrantRegistry>();
        assert!(grants.ensure_workspace(&dir.to_string_lossy()).is_err());
        assert!(app
            .state::<WindowRegistry>()
            .take_pending("main")
            .is_empty());
    }

    #[test]
    fn a_drag_from_outside_after_the_page_s_own_is_honoured_again() {
        let dir = unique_tmp("next_drag");
        let (app, window) = app_with_main();
        let sources = app.state::<DragSources>();
        sources.record("main", true);
        sources.record("main", false);

        handle_window_event(&window, &drop_of(vec![dir.clone()]));

        assert!(app
            .state::<GrantRegistry>()
            .ensure_workspace(&dir.to_string_lossy())
            .is_ok());
    }

    #[test]
    fn a_destroyed_window_leaves_the_routing_registry() {
        let (app, window) = app_with_main();
        let registry = app.state::<WindowRegistry>();
        registry.set_files("main", vec!["/w/note.md".to_string()]);
        assert_eq!(registry.documents().0, vec!["/w/note.md".to_string()]);

        handle_window_event(&window, &WindowEvent::Destroyed);

        assert!(registry.documents().0.is_empty());
    }

    #[test]
    fn another_window_s_own_drag_does_not_block_this_one() {
        let dir = unique_tmp("other_window");
        let (app, window) = app_with_main();
        app.state::<DragSources>().record("w1", true);

        handle_window_event(&window, &drop_of(vec![dir.clone()]));

        assert!(app
            .state::<GrantRegistry>()
            .ensure_workspace(&dir.to_string_lossy())
            .is_ok());
    }
}
