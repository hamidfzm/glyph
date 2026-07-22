// Runtime half of multi-window routing: focusing, spawning, and messaging real
// Tauri windows. Every function here drives the live window manager, so it
// can't be exercised from `MockRuntime`; the testable decision logic lives in
// [`crate::windows`] and this file is excluded from codecov (see codecov.yml),
// mirroring `menu_runtime`.

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::grants::{self, GrantRegistry};
use crate::windows::{route_open, OpenKind, OpenRoute, PendingOpen, WindowRegistry};

/// Mint the grant for a backend-observed open and mirror it into the
/// asset-protocol scope; grant failures are ignored (the open surfaces the
/// error and the path stays denied).
fn grant_open<R: Runtime>(app: &AppHandle<R>, kind: OpenKind, path: &str) {
    let Some(registry) = app.try_state::<GrantRegistry>() else {
        return;
    };
    match kind {
        OpenKind::Folder => {
            if let Ok(canonical) = registry.grant_workspace(std::path::Path::new(path)) {
                grants::allow_asset_dir(app, &canonical);
            }
        }
        OpenKind::File => {
            if let Ok(canonical) = registry.grant_file(std::path::Path::new(path)) {
                grants::allow_asset_file(app, &canonical);
            }
        }
    }
}

/// The frontend event a pending open is delivered as.
fn event_name(kind: OpenKind) -> &'static str {
    match kind {
        OpenKind::Folder => "open-folder",
        OpenKind::File => "open-file",
    }
}

/// Bring a window to the front (un-minimizing and showing it first).
pub fn focus_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        // Mobile windows can't be minimized, and the method doesn't exist there.
        #[cfg(desktop)]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The window an OS-level open (or menu action) should treat as "current":
/// the focused one, else `main`, else any window. Preferring `main` keeps the
/// no-focus fallback deterministic instead of HashMap iteration order.
pub fn current_window_label<R: Runtime>(app: &AppHandle<R>) -> String {
    let windows = app.webview_windows();
    if let Some((label, _)) = windows
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
    {
        return label.clone();
    }
    if windows.contains_key("main") {
        return "main".to_string();
    }
    windows
        .into_keys()
        .next()
        .unwrap_or_else(|| "main".to_string())
}

/// Route and apply an open request against the live window set.
pub fn open_in_app<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    kind: OpenKind,
    path: String,
    current_label: &str,
) {
    grant_open(app, kind, &path);
    match route_open(kind, &path, &registry.snapshot(), current_label) {
        OpenRoute::Focus(label) => focus_window(app, &label),
        OpenRoute::Adopt(label, pending) => {
            focus_window(app, &label);
            // emit_to targets just this window; a window's `.emit` would
            // broadcast to every window in Tauri v2.
            let _ = app.emit_to(&label, event_name(pending.kind), pending.path);
        }
        OpenRoute::NewWindow(pending) => spawn_window(app, registry, pending),
    }
}

/// Spawn a new window pre-loaded with `pending`. The folder is registered
/// immediately so a second request for it focuses this window instead of
/// spawning a duplicate, and injected as `window.__GLYPH_OPEN__` so the
/// frontend adopts it on mount. `__GLYPH_PRIMARY__ = false` marks the window as
/// secondary (it neither persists nor restores the session).
///
/// The build runs off-thread: every caller sits on the main thread (sync
/// command, drag-drop, single-instance callback), and building a webview there
/// deadlocks Windows (wry#583). WebView2 init completes via the message pump
/// the caller is blocking, freezing every window and leaving the new one white.
fn spawn_window<R: Runtime>(app: &AppHandle<R>, registry: &WindowRegistry, pending: PendingOpen) {
    let label = registry.next_label();
    if pending.kind == OpenKind::Folder {
        registry.set_workspace(&label, Some(pending.path.clone()));
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let payload = serde_json::to_string(&pending).unwrap_or_else(|_| "null".to_string());
        let script = format!("window.__GLYPH_OPEN__={payload};window.__GLYPH_PRIMARY__=false;");
        #[allow(unused_mut)]
        // Hidden like the main window (tauri.conf.json visible: false): the
        // frontend's useWindowReveal shows it after the first themed paint,
        // instead of flashing a white native window while the webview loads.
        let mut builder =
            WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
                .title("Glyph")
                .inner_size(960.0, 720.0)
                .visible(false)
                .initialization_script(&script);
        // Windows cannot share one native menu across windows (a Win32 HMENU
        // attaches to a single window), so each spawned window gets its own
        // menu instance instead of inheriting the app-wide one. Its state and
        // labels are pushed by the window's own frontend on mount.
        #[cfg(windows)]
        if let Ok((menu, refs)) = crate::menu::build_menu(&app, Some(&label)) {
            let _ = crate::menu::apply_menu_state(&refs, &crate::menu::MenuStateFlags::default());
            if let Some(menus) = app.try_state::<crate::menu::MenuRegistry<R>>() {
                menus.insert(&label, refs);
            }
            builder = builder.menu(menu);
        }
        let built = builder.build();
        if built.is_err() {
            // The window will never report back, so drop the phantom workspace
            // entry that would swallow future open requests.
            if let Some(registry) = app.try_state::<WindowRegistry>() {
                registry.remove(&label);
            }
        }
    });
}

/// Frontend reports the workspace its window now shows (or `None` when cleared),
/// keeping the routing registry current.
#[tauri::command]
pub fn set_window_workspace<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, WindowRegistry>,
    root: Option<String>,
) {
    // Restore-flow re-opens skip open_in_app, so mint the grant here too.
    // Clearing (None) does not revoke: grants are session-scoped.
    if let Some(root) = &root {
        grant_open(window.app_handle(), OpenKind::Folder, root);
    }
    registry.set_workspace(window.label(), root);
}

/// In-app open request (the Open Folder dialog, or opening a loose file),
/// routed the same way as OS-level launches with the calling window as current.
#[tauri::command]
pub fn request_open<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: AppHandle<R>,
    registry: State<'_, WindowRegistry>,
    kind: String,
    path: String,
) {
    let kind = if kind == "file" {
        OpenKind::File
    } else {
        OpenKind::Folder
    };
    let label = window.label().to_string();
    open_in_app(&app, &registry, kind, path, &label);
}
