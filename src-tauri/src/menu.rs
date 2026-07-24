// Pure menu-action plumbing. Everything in this file is independent of the
// Tauri runtime: `MenuAction` is plain data, `menu_action_for_id` is a pure
// `&str -> Option<MenuAction>` mapping, and `dispatch_menu_action` is generic
// over `tauri::Runtime` so it can be driven by `tauri::test::MockRuntime`.
//
// The runtime-bound half (build_menu / apply_menu_state / handle_menu_event)
// lives in [`crate::menu_runtime`] and is excluded from codecov. We re-export
// the surface here so callers can write `menu::build_menu(...)` and don't have
// to know about the split.

pub use crate::menu_runtime::{
    apply_menu_state, build_menu, handle_menu_event, MenuRegistry, MenuStateFlags,
};

use tauri::{Emitter, Manager};

/// What a native menu item id maps to. `Emit` forwards an event (with an
/// optional string payload) to the frontend; `CloseWindow` closes the window
/// whose menu was used; `ToggleDevTools` (debug builds only) toggles the
/// WebView's DevTools panel. Returning `None` from [`menu_action_for_id`] means
/// the id isn't recognised, so `handle_menu_event` is a no-op.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    Emit {
        event: &'static str,
        payload: Option<&'static str>,
    },
    CloseWindow,
    #[cfg(debug_assertions)]
    ToggleDevTools,
}

/// Split a menu item id into its owning-window label and base id. Per-window
/// menus (Windows) build ids like "w1:close-tab" so events route to the owning
/// window without relying on focus; bare ids (shared app menu on macOS/Linux)
/// return None and the caller falls back to the focused window.
pub fn parse_menu_id(id: &str) -> (Option<&str>, &str) {
    match id.split_once(':') {
        Some((label, base)) => (Some(label), base),
        None => (None, id),
    }
}

/// Pure mapping from a native menu item id to the action `handle_menu_event`
/// should perform. Split out so each arm is unit-testable without spinning up
/// a Tauri runtime.
pub fn menu_action_for_id(id: &str) -> Option<MenuAction> {
    let emit = |event| {
        Some(MenuAction::Emit {
            event,
            payload: None,
        })
    };
    match id {
        "open" => emit("menu-open-file"),
        "open-folder" => emit("menu-open-folder"),
        "new-workspace" => emit("menu-new-workspace"),
        "open-graph" => emit("menu-open-graph"),
        "close-tab" => emit("menu-close-tab"),
        "close-workspace" => emit("menu-close-workspace"),
        "reset-view" => emit("menu-reset-view"),
        "print" => emit("menu-print"),
        "export-html" => emit("menu-export-html"),
        "export-docx" => emit("menu-export-docx"),
        "export-epub" => emit("menu-export-epub"),
        "export-pdf" => emit("menu-export-pdf"),
        "export-website" => emit("menu-export-website"),
        "workspace-settings" => emit("menu-workspace-settings"),
        "close" => Some(MenuAction::CloseWindow),
        "toggle-files-sidebar" => emit("menu-toggle-files-sidebar"),
        "toggle-outline-sidebar" => emit("menu-toggle-outline-sidebar"),
        "open-command-palette" => emit("menu-open-command-palette"),
        "open-settings" => emit("menu-open-settings"),
        "open-sync-settings" => emit("menu-open-sync-settings"),
        "manage-plugins" => emit("menu-manage-plugins"),
        "ai-chat" => emit("menu-ai-chat"),
        "ai-summarize" => Some(MenuAction::Emit {
            event: "menu-ai-action",
            payload: Some("summarize"),
        }),
        "ai-explain" => Some(MenuAction::Emit {
            event: "menu-ai-action",
            payload: Some("explain"),
        }),
        "ai-simplify" => Some(MenuAction::Emit {
            event: "menu-ai-action",
            payload: Some("simplify"),
        }),
        "ai-read-aloud" => emit("menu-ai-read-aloud"),
        "zoom-in" => emit("menu-zoom-in"),
        "zoom-out" => emit("menu-zoom-out"),
        "actual-size" => emit("menu-zoom-reset"),
        "find" => emit("menu-find"),
        "toggle-edit" => emit("menu-toggle-edit"),
        "documentation" => emit("menu-documentation"),
        "release-notes" => emit("menu-release-notes"),
        "report-issue" => emit("menu-report-issue"),
        #[cfg(debug_assertions)]
        "toggle-devtools" => Some(MenuAction::ToggleDevTools),
        _ => None,
    }
}

/// Dispatch a resolved [`MenuAction`] against an `AppHandle`, targeting the
/// window whose menu was used (`window_label`). Split out from
/// `handle_menu_event` (in `menu_runtime`) so it can be unit-tested with
/// `tauri::test::MockRuntime` — `MenuEvent` itself has no public constructor.
pub fn dispatch_menu_action<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    action: MenuAction,
) {
    match action {
        MenuAction::Emit { event, payload } => {
            // emit_to targets just this window; a plain app.emit would broadcast
            // to every window in Tauri v2, firing the action in all of them.
            let _ = app.emit_to(window_label, event, payload);
        }
        MenuAction::CloseWindow => {
            if let Some(window) = app.get_webview_window(window_label) {
                let _ = window.close();
            }
        }
        #[cfg(debug_assertions)]
        MenuAction::ToggleDevTools => {
            if let Some(window) = app.get_webview_window(window_label) {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emit(event: &'static str) -> MenuAction {
        MenuAction::Emit {
            event,
            payload: None,
        }
    }

    fn emit_with(event: &'static str, payload: &'static str) -> MenuAction {
        MenuAction::Emit {
            event,
            payload: Some(payload),
        }
    }

    #[test]
    fn unknown_id_returns_none() {
        assert!(menu_action_for_id("not-a-thing").is_none());
        assert!(menu_action_for_id("").is_none());
    }

    #[test]
    fn parse_menu_id_splits_owner_prefixed_ids() {
        // Regression: per-window menus (Windows) embed the owning label so a
        // menu click routes to its own window, not the focused-window guess
        // (focus reads false while the Win32 menu loop is closing, which sent
        // one window's Close Workspace to main).
        assert_eq!(
            parse_menu_id("w1:close-workspace"),
            (Some("w1"), "close-workspace")
        );
        assert_eq!(parse_menu_id("main:open"), (Some("main"), "open"));
        assert_eq!(parse_menu_id("close-tab"), (None, "close-tab"));
        assert_eq!(parse_menu_id(""), (None, ""));
    }

    #[test]
    fn file_menu_ids_emit_their_events() {
        assert_eq!(menu_action_for_id("open"), Some(emit("menu-open-file")));
        assert_eq!(
            menu_action_for_id("open-folder"),
            Some(emit("menu-open-folder"))
        );
        assert_eq!(
            menu_action_for_id("new-workspace"),
            Some(emit("menu-new-workspace"))
        );
        assert_eq!(
            menu_action_for_id("close-tab"),
            Some(emit("menu-close-tab"))
        );
        assert_eq!(
            menu_action_for_id("close-workspace"),
            Some(emit("menu-close-workspace"))
        );
        assert_eq!(
            menu_action_for_id("reset-view"),
            Some(emit("menu-reset-view"))
        );
        assert_eq!(menu_action_for_id("print"), Some(emit("menu-print")));
        assert_eq!(
            menu_action_for_id("open-settings"),
            Some(emit("menu-open-settings"))
        );
        assert_eq!(
            menu_action_for_id("open-sync-settings"),
            Some(emit("menu-open-sync-settings"))
        );
        assert_eq!(
            menu_action_for_id("manage-plugins"),
            Some(emit("menu-manage-plugins"))
        );
    }

    #[test]
    fn export_ids_emit_their_events() {
        assert_eq!(
            menu_action_for_id("export-html"),
            Some(emit("menu-export-html"))
        );
        assert_eq!(
            menu_action_for_id("export-docx"),
            Some(emit("menu-export-docx"))
        );
        assert_eq!(
            menu_action_for_id("export-epub"),
            Some(emit("menu-export-epub"))
        );
        assert_eq!(
            menu_action_for_id("export-pdf"),
            Some(emit("menu-export-pdf"))
        );
        assert_eq!(
            menu_action_for_id("export-website"),
            Some(emit("menu-export-website"))
        );
        assert_eq!(
            menu_action_for_id("workspace-settings"),
            Some(emit("menu-workspace-settings"))
        );
    }

    #[test]
    fn close_window_id_returns_close_window_action() {
        assert_eq!(menu_action_for_id("close"), Some(MenuAction::CloseWindow));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn toggle_devtools_id_returns_toggle_devtools_action() {
        assert_eq!(
            menu_action_for_id("toggle-devtools"),
            Some(MenuAction::ToggleDevTools)
        );
    }

    #[test]
    fn view_menu_ids_emit_their_events() {
        assert_eq!(
            menu_action_for_id("toggle-files-sidebar"),
            Some(emit("menu-toggle-files-sidebar"))
        );
        assert_eq!(
            menu_action_for_id("toggle-outline-sidebar"),
            Some(emit("menu-toggle-outline-sidebar"))
        );
        assert_eq!(
            menu_action_for_id("open-command-palette"),
            Some(emit("menu-open-command-palette"))
        );
        assert_eq!(
            menu_action_for_id("open-graph"),
            Some(emit("menu-open-graph"))
        );
        assert_eq!(menu_action_for_id("zoom-in"), Some(emit("menu-zoom-in")));
        assert_eq!(menu_action_for_id("zoom-out"), Some(emit("menu-zoom-out")));
        assert_eq!(
            menu_action_for_id("actual-size"),
            Some(emit("menu-zoom-reset"))
        );
        assert_eq!(menu_action_for_id("find"), Some(emit("menu-find")));
        assert_eq!(
            menu_action_for_id("toggle-edit"),
            Some(emit("menu-toggle-edit"))
        );
    }

    #[test]
    fn ai_action_ids_emit_with_their_payload() {
        assert_eq!(menu_action_for_id("ai-chat"), Some(emit("menu-ai-chat")));
        assert_eq!(
            menu_action_for_id("ai-summarize"),
            Some(emit_with("menu-ai-action", "summarize"))
        );
        assert_eq!(
            menu_action_for_id("ai-explain"),
            Some(emit_with("menu-ai-action", "explain"))
        );
        assert_eq!(
            menu_action_for_id("ai-simplify"),
            Some(emit_with("menu-ai-action", "simplify"))
        );
        assert_eq!(
            menu_action_for_id("ai-read-aloud"),
            Some(emit("menu-ai-read-aloud"))
        );
    }

    #[test]
    fn help_menu_ids_emit_their_events() {
        assert_eq!(
            menu_action_for_id("documentation"),
            Some(emit("menu-documentation"))
        );
        assert_eq!(
            menu_action_for_id("release-notes"),
            Some(emit("menu-release-notes"))
        );
        assert_eq!(
            menu_action_for_id("report-issue"),
            Some(emit("menu-report-issue"))
        );
    }

    // dispatch_menu_action tests drive the side-effecting half of the menu
    // pipeline. We use tauri::test's MockRuntime so app.emit /
    // app.get_webview_window resolve against an in-memory app instead of a
    // real window manager.
    mod dispatch {
        use super::*;
        use std::sync::{Arc, Mutex};
        use tauri::test::{mock_app, MockRuntime};
        use tauri::{Listener, WebviewWindowBuilder};

        fn capture<L: Listener<MockRuntime>>(
            listener: &L,
            event: &'static str,
        ) -> Arc<Mutex<Vec<String>>> {
            let bucket: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&bucket);
            listener.listen(event, move |evt| {
                let raw = evt.payload().to_string();
                sink.lock().unwrap().push(raw.trim_matches('"').to_string());
            });
            bucket
        }

        #[test]
        fn emit_action_fires_the_event_with_no_payload() {
            let app = mock_app();
            let win = WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("mock main window should build");
            let handle = app.handle().clone();
            let seen = capture(&win, "menu-open-file");

            dispatch_menu_action(
                &handle,
                "main",
                MenuAction::Emit {
                    event: "menu-open-file",
                    payload: None,
                },
            );
            std::thread::sleep(std::time::Duration::from_millis(50));

            assert_eq!(seen.lock().unwrap().len(), 1);
        }

        #[test]
        fn emit_action_fires_the_event_with_string_payload() {
            let app = mock_app();
            let win = WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("mock main window should build");
            let handle = app.handle().clone();
            let seen = capture(&win, "menu-ai-action");

            dispatch_menu_action(
                &handle,
                "main",
                MenuAction::Emit {
                    event: "menu-ai-action",
                    payload: Some("summarize"),
                },
            );
            std::thread::sleep(std::time::Duration::from_millis(50));

            let seen = seen.lock().unwrap().clone();
            assert_eq!(seen, vec!["summarize".to_string()]);
        }

        #[test]
        fn emit_action_targets_only_the_named_window() {
            // Regression for the multi-window broadcast bug: dispatching to "w1"
            // must reach only w1's listener, never main's — otherwise Close
            // Workspace / Close Tab in one window would fire in every window.
            let app = mock_app();
            let main = WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("mock main window should build");
            let w1 = WebviewWindowBuilder::new(&app, "w1", Default::default())
                .build()
                .expect("mock w1 window should build");
            let handle = app.handle().clone();
            let on_main = capture(&main, "menu-close-workspace");
            let on_w1 = capture(&w1, "menu-close-workspace");

            dispatch_menu_action(
                &handle,
                "w1",
                MenuAction::Emit {
                    event: "menu-close-workspace",
                    payload: None,
                },
            );
            std::thread::sleep(std::time::Duration::from_millis(50));

            assert_eq!(on_w1.lock().unwrap().len(), 1);
            assert_eq!(on_main.lock().unwrap().len(), 0);
        }

        #[test]
        fn close_window_action_with_no_such_window_is_a_silent_noop() {
            // Plain mock_app() has no matching window; the if-let-Some arm short
            // -circuits without panicking.
            let app = mock_app();
            let handle = app.handle().clone();
            dispatch_menu_action(&handle, "main", MenuAction::CloseWindow);
        }

        #[test]
        fn close_window_action_closes_the_named_window() {
            // Close Window must target the window whose menu was used, not a
            // hardcoded "main": building "w1" and dispatching with "w1" drives
            // the get_webview_window(label) Some arm. We don't assert the
            // post-close manager state because MockRuntime's close() doesn't
            // synchronously drop the registered window; reaching the dispatch
            // path for the named window without panicking is the coverage.
            let app = mock_app();
            WebviewWindowBuilder::new(&app, "w1", Default::default())
                .build()
                .expect("mock w1 window should build");
            let handle = app.handle().clone();
            assert!(handle.get_webview_window("w1").is_some());

            dispatch_menu_action(&handle, "w1", MenuAction::CloseWindow);
        }

        #[cfg(debug_assertions)]
        #[test]
        fn toggle_devtools_with_no_main_window_is_a_silent_noop() {
            let app = mock_app();
            let handle = app.handle().clone();
            dispatch_menu_action(&handle, "main", MenuAction::ToggleDevTools);
        }

        #[cfg(debug_assertions)]
        #[test]
        fn toggle_devtools_opens_devtools_when_a_main_window_exists() {
            // MockRuntime reports is_devtools_open() as false and implements
            // open_devtools() as a no-op, so this drives the open arm. The
            // close arm needs a runtime that reports devtools as open, which
            // the mock can't do.
            let app = mock_app();
            WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("mock main window should build");
            let handle = app.handle().clone();

            dispatch_menu_action(&handle, "main", MenuAction::ToggleDevTools);
        }
    }
}
