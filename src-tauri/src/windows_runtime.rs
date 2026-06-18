// Runtime half of multi-window routing: focusing, spawning, and messaging real
// Tauri windows. Every function here drives the live window manager, so it
// can't be exercised from `MockRuntime`; the testable decision logic lives in
// [`crate::windows`] and this file is excluded from codecov (see codecov.yml),
// mirroring `menu_runtime`.

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::windows::{route_open, OpenKind, OpenRoute, PendingOpen, WindowRegistry};

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
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The window an OS-level open should treat as "current": the focused one, else
/// any window, else `main`.
pub fn current_window_label<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Some((label, _)) = app
        .webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
    {
        return label;
    }
    app.webview_windows()
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
fn spawn_window<R: Runtime>(app: &AppHandle<R>, registry: &WindowRegistry, pending: PendingOpen) {
    let label = registry.next_label();
    if pending.kind == OpenKind::Folder {
        registry.set_workspace(&label, Some(pending.path.clone()));
    }
    let payload = serde_json::to_string(&pending).unwrap_or_else(|_| "null".to_string());
    let script = format!("window.__GLYPH_OPEN__={payload};window.__GLYPH_PRIMARY__=false;");
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Glyph")
        .inner_size(960.0, 720.0)
        .initialization_script(&script)
        .build();
    if built.is_err() {
        // Building failed, so the window will never report back — don't leave a
        // phantom workspace entry that would swallow future open requests.
        registry.remove(&label);
    }
}

/// Frontend reports the workspace its window now shows (or `None` when cleared),
/// keeping the routing registry current.
#[tauri::command]
pub fn set_window_workspace<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, WindowRegistry>,
    root: Option<String>,
) {
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
