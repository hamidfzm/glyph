use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Manager, Wry,
};

pub fn build_menu(app: &App) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let handle = app.handle();

    // File menu
    let open = MenuItemBuilder::with_id("open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let close = MenuItemBuilder::with_id("close", "Close Window")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;

    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&open)
        .separator()
        .item(&close)
        .build()?;

    // Edit menu
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .copy()
        .select_all()
        .build()?;

    // View menu
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(handle)?;

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&toggle_sidebar)
        .separator()
        .fullscreen()
        .build()?;

    // Help menu
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Glyph"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A modern, cross-platform markdown viewer"))
        .website(Some("https://github.com/hamidfzm/glyph"))
        .license(Some("MIT"))
        .build();

    let help_menu = SubmenuBuilder::new(handle, "Help")
        .about(Some(about_metadata))
        .build()?;

    // macOS app menu
    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(handle, "Glyph")
            .about(None)
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
            .item(&help_menu)
            .build()?
    };

    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(handle)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open" => {
            let _ = app.emit("menu-open-file", ());
        }
        "close" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "toggle-sidebar" => {
            let _ = app.emit("menu-toggle-sidebar", ());
        }
        _ => {}
    }
}
