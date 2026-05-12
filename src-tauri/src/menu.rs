use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Manager, Wry,
};

pub fn build_menu(app: &App) -> tauri::Result<tauri::menu::Menu<Wry>> {
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
    let toggle_files_sidebar =
        MenuItemBuilder::with_id("toggle-files-sidebar", "Toggle Files Sidebar")
            .accelerator("CmdOrCtrl+B")
            .build(handle)?;
    let toggle_outline_sidebar =
        MenuItemBuilder::with_id("toggle-outline-sidebar", "Toggle Outline Sidebar")
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
    let ai_summarize =
        MenuItemBuilder::with_id("ai-summarize", "Summarize Document").build(handle)?;
    let ai_explain = MenuItemBuilder::with_id("ai-explain", "Explain Document").build(handle)?;
    let ai_simplify = MenuItemBuilder::with_id("ai-simplify", "Simplify Document").build(handle)?;
    let ai_read_aloud = MenuItemBuilder::with_id("ai-read-aloud", "Read Aloud").build(handle)?;

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

    Ok(menu)
}

/// Action a menu item triggers. `CloseWindow` is handled specially because it
/// touches the window directly; every other entry just emits an event to the
/// frontend. Keeping this as a pure mapping makes the wiring testable without
/// booting a Tauri app.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    Emit(&'static str),
    EmitWithPayload(&'static str, &'static str),
    CloseWindow,
}

pub fn menu_action(id: &str) -> Option<MenuAction> {
    Some(match id {
        "open" => MenuAction::Emit("menu-open-file"),
        "open-folder" => MenuAction::Emit("menu-open-folder"),
        "close-tab" => MenuAction::Emit("menu-close-tab"),
        "reset-view" => MenuAction::Emit("menu-reset-view"),
        "print" => MenuAction::Emit("menu-print"),
        "close" => MenuAction::CloseWindow,
        "toggle-files-sidebar" => MenuAction::Emit("menu-toggle-files-sidebar"),
        "toggle-outline-sidebar" => MenuAction::Emit("menu-toggle-outline-sidebar"),
        "open-settings" => MenuAction::Emit("menu-open-settings"),
        "ai-summarize" => MenuAction::EmitWithPayload("menu-ai-action", "summarize"),
        "ai-explain" => MenuAction::EmitWithPayload("menu-ai-action", "explain"),
        "ai-simplify" => MenuAction::EmitWithPayload("menu-ai-action", "simplify"),
        "ai-read-aloud" => MenuAction::Emit("menu-ai-read-aloud"),
        "zoom-in" => MenuAction::Emit("menu-zoom-in"),
        "zoom-out" => MenuAction::Emit("menu-zoom-out"),
        "actual-size" => MenuAction::Emit("menu-zoom-reset"),
        "find" => MenuAction::Emit("menu-find"),
        "toggle-edit" => MenuAction::Emit("menu-toggle-edit"),
        _ => return None,
    })
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match menu_action(event.id().as_ref()) {
        Some(MenuAction::Emit(name)) => {
            let _ = app.emit(name, ());
        }
        Some(MenuAction::EmitWithPayload(name, payload)) => {
            let _ = app.emit(name, payload);
        }
        Some(MenuAction::CloseWindow) => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_id_yields_no_action() {
        assert!(menu_action("does-not-exist").is_none());
        assert!(menu_action("").is_none());
    }

    #[test]
    fn close_id_maps_to_close_window() {
        assert_eq!(menu_action("close"), Some(MenuAction::CloseWindow));
    }

    #[test]
    fn file_menu_emits() {
        assert_eq!(
            menu_action("open"),
            Some(MenuAction::Emit("menu-open-file"))
        );
        assert_eq!(
            menu_action("open-folder"),
            Some(MenuAction::Emit("menu-open-folder"))
        );
        assert_eq!(menu_action("print"), Some(MenuAction::Emit("menu-print")));
        assert_eq!(
            menu_action("close-tab"),
            Some(MenuAction::Emit("menu-close-tab"))
        );
        assert_eq!(
            menu_action("open-settings"),
            Some(MenuAction::Emit("menu-open-settings"))
        );
    }

    #[test]
    fn view_menu_emits() {
        assert_eq!(
            menu_action("toggle-files-sidebar"),
            Some(MenuAction::Emit("menu-toggle-files-sidebar"))
        );
        assert_eq!(
            menu_action("toggle-outline-sidebar"),
            Some(MenuAction::Emit("menu-toggle-outline-sidebar"))
        );
        assert_eq!(
            menu_action("toggle-edit"),
            Some(MenuAction::Emit("menu-toggle-edit"))
        );
        assert_eq!(
            menu_action("zoom-in"),
            Some(MenuAction::Emit("menu-zoom-in"))
        );
        assert_eq!(
            menu_action("zoom-out"),
            Some(MenuAction::Emit("menu-zoom-out"))
        );
        assert_eq!(
            menu_action("actual-size"),
            Some(MenuAction::Emit("menu-zoom-reset"))
        );
        assert_eq!(
            menu_action("reset-view"),
            Some(MenuAction::Emit("menu-reset-view"))
        );
    }

    #[test]
    fn edit_menu_emits() {
        assert_eq!(menu_action("find"), Some(MenuAction::Emit("menu-find")));
    }

    #[test]
    fn ai_menu_emits_action_payloads() {
        assert_eq!(
            menu_action("ai-summarize"),
            Some(MenuAction::EmitWithPayload("menu-ai-action", "summarize"))
        );
        assert_eq!(
            menu_action("ai-explain"),
            Some(MenuAction::EmitWithPayload("menu-ai-action", "explain"))
        );
        assert_eq!(
            menu_action("ai-simplify"),
            Some(MenuAction::EmitWithPayload("menu-ai-action", "simplify"))
        );
        assert_eq!(
            menu_action("ai-read-aloud"),
            Some(MenuAction::Emit("menu-ai-read-aloud"))
        );
    }
}
