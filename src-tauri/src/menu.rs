use serde::Deserialize;
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Manager, State, Wry,
};

/// Handles to the menu items whose enabled state changes at runtime.
/// Held in managed state so the `set_menu_state` command can toggle them.
#[derive(Clone)]
pub struct MenuItemRefs {
    close_tab: MenuItem<Wry>,
    print: MenuItem<Wry>,
    find: MenuItem<Wry>,
    toggle_edit: MenuItem<Wry>,
    ai_summarize: MenuItem<Wry>,
    ai_explain: MenuItem<Wry>,
    ai_simplify: MenuItem<Wry>,
    ai_read_aloud: MenuItem<Wry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuStateFlags {
    pub has_tab: bool,
    pub has_file: bool,
    pub has_content: bool,
    pub ai_configured: bool,
    pub tts_available: bool,
}

pub fn build_menu(app: &App) -> tauri::Result<(tauri::menu::Menu<Wry>, MenuItemRefs)> {
    let handle = app.handle();

    // Shared menu items
    let open = MenuItemBuilder::with_id("open", "Open\u{2026}")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", "Open Folder\u{2026}")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(handle)?;
    let reset_view = MenuItemBuilder::with_id("reset-view", "Reset View").build(handle)?;
    let print = MenuItemBuilder::with_id("print", "Print\u{2026}")
        .accelerator("CmdOrCtrl+P")
        .build(handle)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let close = MenuItemBuilder::with_id("close", "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(handle)?;
    let settings = MenuItemBuilder::with_id("open-settings", "Settings\u{2026}")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;

    // Edit menu
    let find = MenuItemBuilder::with_id("find", "Find\u{2026}")
        .accelerator("CmdOrCtrl+F")
        .build(handle)?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .copy()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    // View menu
    let command_palette = MenuItemBuilder::with_id("open-command-palette", "Command Palette\u{2026}")
        .accelerator("CmdOrCtrl+K")
        .build(handle)?;
    let toggle_files_sidebar = MenuItemBuilder::with_id("toggle-files-sidebar", "Toggle Files Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(handle)?;
    let toggle_outline_sidebar = MenuItemBuilder::with_id("toggle-outline-sidebar", "Toggle Outline Sidebar")
        .accelerator("CmdOrCtrl+\\")
        .build(handle)?;

    let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(handle)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(handle)?;
    let actual_size = MenuItemBuilder::with_id("actual-size", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(handle)?;

    let toggle_edit = MenuItemBuilder::with_id("toggle-edit", "Toggle Edit Mode")
        .accelerator("CmdOrCtrl+E")
        .build(handle)?;

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&command_palette)
        .separator()
        .item(&toggle_files_sidebar)
        .item(&toggle_outline_sidebar)
        .item(&toggle_edit)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&actual_size)
        .separator()
        .item(&reset_view)
        .separator()
        .fullscreen()
        .build()?;

    // AI menu
    let ai_summarize = MenuItemBuilder::with_id("ai-summarize", "Summarize Document")
        .build(handle)?;
    let ai_explain = MenuItemBuilder::with_id("ai-explain", "Explain Document")
        .build(handle)?;
    let ai_simplify = MenuItemBuilder::with_id("ai-simplify", "Simplify Document")
        .build(handle)?;
    let ai_read_aloud = MenuItemBuilder::with_id("ai-read-aloud", "Read Aloud")
        .build(handle)?;

    let ai_menu = SubmenuBuilder::new(handle, "AI")
        .item(&ai_summarize)
        .item(&ai_explain)
        .item(&ai_simplify)
        .separator()
        .item(&ai_read_aloud)
        .build()?;

    // About metadata (shared between app menu on macOS and Help menu elsewhere)
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Glyph"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A modern, cross-platform markdown viewer"))
        .website(Some("https://github.com/hamidfzm/glyph"))
        .license(Some("MIT"))
        .build();

    // Help menu
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .about(Some(about_metadata.clone()))
        .build()?;

    // macOS: Settings goes in app menu, File menu is simple
    #[cfg(target_os = "macos")]
    let menu = {
        let file_menu = SubmenuBuilder::new(handle, "File")
            .item(&open)
            .item(&open_folder)
            .separator()
            .item(&print)
            .separator()
            .item(&close_tab)
            .item(&close)
            .build()?;

        let app_menu = SubmenuBuilder::new(handle, "Glyph")
            .about(Some(about_metadata))
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

        MenuBuilder::new(handle)
            .item(&app_menu)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&ai_menu)
            .item(&help_menu)
            .build()?
    };

    // Windows/Linux: Settings goes in File menu
    #[cfg(not(target_os = "macos"))]
    let menu = {
        let file_menu = SubmenuBuilder::new(handle, "File")
            .item(&open)
            .item(&open_folder)
            .separator()
            .item(&print)
            .separator()
            .item(&settings)
            .separator()
            .item(&close_tab)
            .item(&close)
            .build()?;

        MenuBuilder::new(handle)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&ai_menu)
            .item(&help_menu)
            .build()?
    };

    let refs = MenuItemRefs {
        close_tab,
        print,
        find,
        toggle_edit,
        ai_summarize,
        ai_explain,
        ai_simplify,
        ai_read_aloud,
    };

    Ok((menu, refs))
}

/// Apply enabled flags to every conditional menu item. Errors from individual
/// items are propagated as strings so the command can surface them.
pub fn apply_menu_state(refs: &MenuItemRefs, flags: &MenuStateFlags) -> Result<(), String> {
    let stringify = |e: tauri::Error| e.to_string();
    refs.close_tab.set_enabled(flags.has_tab).map_err(stringify)?;
    refs.print.set_enabled(flags.has_file).map_err(stringify)?;
    refs.find.set_enabled(flags.has_file).map_err(stringify)?;
    refs.toggle_edit
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    let ai_enabled = flags.ai_configured && flags.has_content;
    refs.ai_summarize.set_enabled(ai_enabled).map_err(stringify)?;
    refs.ai_explain.set_enabled(ai_enabled).map_err(stringify)?;
    refs.ai_simplify.set_enabled(ai_enabled).map_err(stringify)?;
    refs.ai_read_aloud
        .set_enabled(flags.tts_available && flags.has_content)
        .map_err(stringify)?;
    Ok(())
}

#[tauri::command]
pub fn set_menu_state(refs: State<MenuItemRefs>, flags: MenuStateFlags) -> Result<(), String> {
    apply_menu_state(&refs, &flags)
}

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
/// [`handle_menu_event`] so it can be unit-tested with `tauri::test::MockRuntime`
/// (handle_menu_event takes a `MenuEvent` which can't be constructed manually).
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

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if let Some(action) = menu_action_for_id(event.id().as_ref()) {
        dispatch_menu_action(app, action);
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

    // dispatch_menu_action tests drive the side-effecting half of
    // handle_menu_event (the half handle_menu_event itself can't be tested
    // because MenuEvent has no public constructor). We use tauri::test's
    // MockRuntime so app.emit / app.get_webview_window resolve against an
    // in-memory app instead of a real window manager.
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
                sink.lock()
                    .unwrap()
                    .push(raw.trim_matches('"').to_string());
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
