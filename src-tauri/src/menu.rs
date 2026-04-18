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
    let print = MenuItemBuilder::with_id("print", "Print\u{2026}")
        .accelerator("CmdOrCtrl+P")
        .build(handle)?;
    let close = MenuItemBuilder::with_id("close", "Close Window")
        .accelerator("CmdOrCtrl+W")
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
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
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
        .item(&toggle_sidebar)
        .item(&toggle_edit)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&actual_size)
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
            .separator()
            .item(&print)
            .separator()
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
            .separator()
            .item(&print)
            .separator()
            .item(&settings)
            .separator()
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

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open" => {
            let _ = app.emit("menu-open-file", ());
        }
        "print" => {
            let _ = app.emit("menu-print", ());
        }
        "close" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "toggle-sidebar" => {
            let _ = app.emit("menu-toggle-sidebar", ());
        }
        "open-settings" => {
            let _ = app.emit("menu-open-settings", ());
        }
        "ai-summarize" => {
            let _ = app.emit("menu-ai-action", "summarize");
        }
        "ai-explain" => {
            let _ = app.emit("menu-ai-action", "explain");
        }
        "ai-simplify" => {
            let _ = app.emit("menu-ai-action", "simplify");
        }
        "ai-read-aloud" => {
            let _ = app.emit("menu-ai-read-aloud", ());
        }
        "zoom-in" => {
            let _ = app.emit("menu-zoom-in", ());
        }
        "zoom-out" => {
            let _ = app.emit("menu-zoom-out", ());
        }
        "actual-size" => {
            let _ = app.emit("menu-zoom-reset", ());
        }
        "find" => {
            let _ = app.emit("menu-find", ());
        }
        "toggle-edit" => {
            let _ = app.emit("menu-toggle-edit", ());
        }
        _ => {}
    }
}
