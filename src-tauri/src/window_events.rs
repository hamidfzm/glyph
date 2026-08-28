//! Per-window Tauri events: teardown of the routing registries and drag-drop
//! of folders/files onto a window. Runtime-bound glue, so it lives beside
//! `setup.rs` rather than inside `run()`.

use tauri::{DragDropEvent, Manager, Window, WindowEvent};

#[cfg(desktop)]
use crate::menu;
use crate::{is_supported_file, windows, windows_runtime};

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    // A closed window leaves the routing registry so its workspace and files no
    // longer count toward "is this already open", and releases the watches it
    // owned on the way out.
    if matches!(event, WindowEvent::Destroyed) {
        if let Some(registry) = window.try_state::<windows::WindowRegistry>() {
            let label = window.label();
            crate::watcher::drop_watches(
                window.app_handle(),
                &registry.exclusively_owned_paths(label),
            );
            registry.remove(label);
        }
        #[cfg(desktop)]
        if let Some(menus) = window.try_state::<menu::MenuRegistry>() {
            menus.remove(window.label());
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
}
