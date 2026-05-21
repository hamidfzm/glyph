// Pure menu-action plumbing. Everything in this file is independent of the
// Tauri runtime: `MenuAction` is plain data, `menu_action_for_id` is a pure
// `&str -> Option<MenuAction>` mapping, and `dispatch_menu_action` is generic
// over `tauri::Runtime` so it can be driven by `tauri::test::MockRuntime`.
//
// The runtime-bound half (build_menu / apply_menu_state / handle_menu_event)
// lives in [`crate::menu_runtime`] and is excluded from codecov. We re-export
// the surface here so callers can write `menu::build_menu(...)` and don't have
// to know about the split.

pub use crate::menu_runtime::{apply_menu_state, build_menu, handle_menu_event, MenuStateFlags};

use tauri::{Emitter, Manager};

/// What a native menu item id maps to. `Emit` forwards an event (with an
/// optional string payload) to the frontend; `CloseWindow` closes the main
/// window directly from Rust. Returning `None` from [`menu_action_for_id`]
/// means the id isn't recognised, so `handle_menu_event` is a no-op.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    Emit {
        event: &'static str,
        payload: Option<&'static str>,
    },
    CloseWindow,
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
        "close-tab" => emit("menu-close-tab"),
        "reset-view" => emit("menu-reset-view"),
        "print" => emit("menu-print"),
        "close" => Some(MenuAction::CloseWindow),
        "toggle-files-sidebar" => emit("menu-toggle-files-sidebar"),
        "toggle-outline-sidebar" => emit("menu-toggle-outline-sidebar"),
        "open-command-palette" => emit("menu-open-command-palette"),
        "open-settings" => emit("menu-open-settings"),
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
        _ => None,
    }
}

/// Dispatch a resolved [`MenuAction`] against an `AppHandle`. Split out from
/// `handle_menu_event` (in `menu_runtime`) so it can be unit-tested with
/// `tauri::test::MockRuntime` — `MenuEvent` itself has no public constructor.
pub fn dispatch_menu_action<R: tauri::Runtime>(app: &tauri::AppHandle<R>, action: MenuAction) {
    match action {
        MenuAction::Emit { event, payload } => {
            let _ = app.emit(event, payload);
        }
        MenuAction::CloseWindow => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
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
    fn file_menu_ids_emit_their_events() {
        assert_eq!(menu_action_for_id("open"), Some(emit("menu-open-file")));
        assert_eq!(
            menu_action_for_id("open-folder"),
            Some(emit("menu-open-folder"))
        );
        assert_eq!(
            menu_action_for_id("close-tab"),
            Some(emit("menu-close-tab"))
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
    }

    #[test]
    fn close_window_id_returns_close_window_action() {
        assert_eq!(menu_action_for_id("close"), Some(MenuAction::CloseWindow));
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

    // dispatch_menu_action tests drive the side-effecting half of the menu
    // pipeline. We use tauri::test's MockRuntime so app.emit /
    // app.get_webview_window resolve against an in-memory app instead of a
    // real window manager.
    mod dispatch {
        use super::*;
        use std::sync::{Arc, Mutex};
        use tauri::test::{mock_app, MockRuntime};
        use tauri::{Listener, WebviewWindowBuilder};

        fn capture(
            handle: &tauri::AppHandle<MockRuntime>,
            event: &'static str,
        ) -> Arc<Mutex<Vec<String>>> {
            let bucket: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&bucket);
            handle.listen(event, move |evt| {
                let raw = evt.payload().to_string();
                sink.lock().unwrap().push(raw.trim_matches('"').to_string());
            });
            bucket
        }

        #[test]
        fn emit_action_fires_the_event_with_no_payload() {
            let app = mock_app();
            let handle = app.handle().clone();
            let seen = capture(&handle, "menu-open-file");

            dispatch_menu_action(
                &handle,
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
            let handle = app.handle().clone();
            let seen = capture(&handle, "menu-ai-action");

            dispatch_menu_action(
                &handle,
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
        fn close_window_action_with_no_main_window_is_a_silent_noop() {
            // Plain mock_app() has no main window; the if-let-Some arm short
            // -circuits without panicking.
            let app = mock_app();
            let handle = app.handle().clone();
            dispatch_menu_action(&handle, MenuAction::CloseWindow);
        }

        #[test]
        fn close_window_action_takes_the_some_arm_when_a_main_window_exists() {
            // Building a "main" webview means get_webview_window("main") resolves
            // to Some, which is the branch we couldn't reach with the bare
            // mock_app() above. We don't assert the post-close manager state
            // because MockRuntime's close() doesn't synchronously drop the
            // registered window; reaching the dispatch path without panicking
            // is the coverage we need.
            let app = mock_app();
            WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("mock main window should build");
            let handle = app.handle().clone();
            assert!(handle.get_webview_window("main").is_some());

            dispatch_menu_action(&handle, MenuAction::CloseWindow);
        }
    }
}
