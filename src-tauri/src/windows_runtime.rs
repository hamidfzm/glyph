// Runtime half of multi-window routing: focusing, spawning, and messaging real
// Tauri windows. Focusing and spawning drive the live window manager, so their
// effects can't be observed from `MockRuntime`; the testable decision logic
// lives in [`crate::windows`] and this file is excluded from codecov (see
// codecov.yml), mirroring `menu_runtime`. The command wrappers are still
// exercised below for the parts a mock app can see: the grant check that gates
// `open_in_new_window`, and the registry writes.

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::grants::{self, GrantRegistry};
use crate::windows::{route_open, OpenKind, OpenRoute, OpenTarget, PendingOpen, WindowRegistry};

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

/// Route and apply an open request against the live window set, letting it
/// adopt into the current window where that makes sense.
pub fn open_in_app<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    kind: OpenKind,
    path: String,
    current_label: &str,
) {
    open_with_target(
        app,
        registry,
        kind,
        path,
        current_label,
        OpenTarget::Current,
    );
}

/// Route and apply an open request against the live window set.
fn open_with_target<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    kind: OpenKind,
    path: String,
    current_label: &str,
    target: OpenTarget,
) {
    grant_open(app, kind, &path);
    match route_open(kind, &path, &registry.snapshot(), current_label, target) {
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

/// Spawn a new window pre-loaded with `pending`. The path is registered
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
    match pending.kind {
        OpenKind::Folder => registry.set_workspace(&label, Some(pending.path.clone())),
        OpenKind::File => registry.add_file(&label, pending.path.clone()),
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
            // The window will never report back, so drop the phantom registry
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

/// Frontend reports the file tabs its window has open, keeping the routing
/// registry current so a request for an open file focuses the window showing it.
#[tauri::command]
pub fn set_window_files<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, WindowRegistry>,
    paths: Vec<String>,
) {
    registry.set_files(window.label(), paths);
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

/// Explicit "Open in new window" for a path the renderer names.
///
/// Unlike `request_open`, whose callers all pass a native-dialog result, this
/// path is reachable from ordinary UI (the file tree, the tab strip), so the
/// path is checked against the existing grants *before* anything is routed. A
/// new window can therefore only ever show what this process is already allowed
/// to read: the action cannot widen the session's filesystem scope (INV-5,
/// INV-6). Routing then focuses a window that already shows the path rather
/// than opening a second live buffer over it.
#[tauri::command]
pub fn open_in_new_window<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: AppHandle<R>,
    registry: State<'_, WindowRegistry>,
    grants: State<'_, GrantRegistry>,
    kind: String,
    path: String,
) -> Result<(), String> {
    grants.ensure_readable(&path)?;
    let kind = if kind == "file" {
        OpenKind::File
    } else {
        OpenKind::Folder
    };
    let label = window.label().to_string();
    // The caller closed the source tab before invoking, so drop the path from
    // its entry now instead of waiting for that window's next report. The
    // spawned window checks "is this open elsewhere" as it mounts and would
    // otherwise race a stale entry and bounce straight back to the caller.
    if kind == OpenKind::File {
        registry.remove_file(&label, &path);
    }
    open_with_target(&app, &registry, kind, path, &label, OpenTarget::NewWindow);
    Ok(())
}

/// Whether another window already shows `path`, focusing it when so.
///
/// A note lives in one window: two windows over one file would each hold their
/// own edit buffer and autosave chain, and the later write would silently
/// discard the other's edits. Every in-window open consults this before loading
/// a second copy.
#[tauri::command]
pub fn focus_window_with_file<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: AppHandle<R>,
    registry: State<'_, WindowRegistry>,
    path: String,
) -> bool {
    let label = window.label().to_string();
    match registry.snapshot().window_with_file(&path, &label) {
        Some(other) => {
            focus_window(&app, other);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::WebviewWindowBuilder;

    /// A mock app with a "main" window plus the registries the commands read.
    /// Routing decisions themselves are covered in `crate::windows`; these
    /// tests pin the command-surface behavior a mock runtime can observe.
    fn app_with_registries() -> (tauri::App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
        let app = mock_app();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        app.manage(WindowRegistry::new());
        app.manage(GrantRegistry::default());
        (app, window)
    }

    fn unique_tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_windows_runtime_{}_{}",
            name,
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_in_new_window_denies_a_path_outside_every_grant() {
        // The renderer names this path, so an ungranted one must be refused
        // before anything is routed: a new window cannot widen session scope.
        let (app, window) = app_with_registries();
        let result = open_in_new_window(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            app.state::<GrantRegistry>(),
            "file".to_string(),
            "/nowhere/secret.md".to_string(),
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside the allowed"));
        // Nothing was routed, so no window was registered for the path.
        assert!(app.state::<WindowRegistry>().snapshot().files.is_empty());
    }

    #[test]
    fn open_in_new_window_accepts_a_granted_path() {
        let dir = unique_tmp("granted");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();

        let (app, window) = app_with_registries();
        app.state::<GrantRegistry>().grant_workspace(&dir).unwrap();

        let result = open_in_new_window(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            app.state::<GrantRegistry>(),
            "file".to_string(),
            file.to_string_lossy().to_string(),
        );
        assert!(result.is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_window_files_records_the_calling_window_only() {
        let (app, window) = app_with_registries();
        set_window_files(
            window,
            app.state::<WindowRegistry>(),
            vec!["/a/note.md".to_string()],
        );

        assert_eq!(
            app.state::<WindowRegistry>().snapshot().files,
            vec![("main".to_string(), vec!["/a/note.md".to_string()])]
        );
    }

    #[test]
    fn focus_window_with_file_reports_a_note_held_by_another_window() {
        let (app, window) = app_with_registries();
        app.state::<WindowRegistry>()
            .set_files("w1", vec!["/a/note.md".to_string()]);

        assert!(focus_window_with_file(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            "/a/note.md".to_string(),
        ));
    }

    #[test]
    fn focus_window_with_file_ignores_the_calling_window_s_own_tabs() {
        // Re-opening a note you already have is a tab activation, not a bounce.
        let (app, window) = app_with_registries();
        app.state::<WindowRegistry>()
            .set_files("main", vec!["/a/note.md".to_string()]);

        assert!(!focus_window_with_file(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            "/a/note.md".to_string(),
        ));
    }

    #[test]
    fn focus_window_with_file_is_false_for_a_note_open_nowhere() {
        let (app, window) = app_with_registries();
        assert!(!focus_window_with_file(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            "/a/note.md".to_string(),
        ));
    }

    #[test]
    fn open_in_new_window_releases_the_note_from_the_calling_window() {
        let dir = unique_tmp("release");
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let path = file.to_string_lossy().to_string();

        let (app, window) = app_with_registries();
        app.state::<GrantRegistry>().grant_workspace(&dir).unwrap();
        app.state::<WindowRegistry>()
            .set_files("main", vec![path.clone()]);

        open_in_new_window(
            window,
            app.handle().clone(),
            app.state::<WindowRegistry>(),
            app.state::<GrantRegistry>(),
            "file".to_string(),
            path.clone(),
        )
        .unwrap();

        // "main" no longer claims it, so the spawned window is not bounced back.
        let registry = app.state::<WindowRegistry>();
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.window_with_file(&path, "w1"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn current_window_label_falls_back_to_main() {
        let (app, _window) = app_with_registries();
        assert_eq!(current_window_label(app.handle()), "main");
    }
}
