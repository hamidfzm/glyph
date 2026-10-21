//! Registers the navigation guard on the app builder. Tauri-runtime wiring
//! for `navigation::is_app_url`, kept apart from it like `menu_runtime` and
//! `windows_runtime`: the `on_navigation` closure only ever runs inside a
//! real webview, which `MockRuntime` never navigates.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

use crate::navigation::is_app_url;

/// Registered on the app builder, so it covers the main window and every
/// window `windows_runtime::spawn_window` builds.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            // Only a dev build loads the page from `build.devUrl`.
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.as_ref()
            } else {
                None
            };
            is_app_url(url, dev_url)
        })
        .build()
}
