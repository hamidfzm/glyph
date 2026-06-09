// Tauri-runtime menu wiring. Everything in this file directly drives the
// native menu manager (build_menu) or fires inside a Tauri-delivered
// MenuEvent (handle_menu_event), so it cannot be exercised from a
// `MockRuntime` unit test. The testable halves of the menu pipeline
// (`MenuAction`, `menu_action_for_id`, `dispatch_menu_action`) live in
// [`crate::menu`] and have direct tests there; this file is excluded from
// codecov so it doesn't drag the patch coverage down.

use std::collections::HashMap;

use serde::Deserialize;
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    App, State, Wry,
};

use crate::menu::{dispatch_menu_action, menu_action_for_id};

/// Handles to the menu items whose enabled state or accelerator changes at
/// runtime. Held in managed state so the `set_menu_state` and
/// `apply_keybindings` commands can mutate them.
#[derive(Clone)]
pub struct MenuItemRefs {
    open: MenuItem<Wry>,
    open_folder: MenuItem<Wry>,
    close_tab: MenuItem<Wry>,
    print: MenuItem<Wry>,
    export_html: MenuItem<Wry>,
    export_docx: MenuItem<Wry>,
    export_epub: MenuItem<Wry>,
    export_pdf: MenuItem<Wry>,
    find: MenuItem<Wry>,
    command_palette: MenuItem<Wry>,
    toggle_files_sidebar: MenuItem<Wry>,
    toggle_outline_sidebar: MenuItem<Wry>,
    toggle_edit: MenuItem<Wry>,
    zoom_in: MenuItem<Wry>,
    zoom_out: MenuItem<Wry>,
    actual_size: MenuItem<Wry>,
    settings: MenuItem<Wry>,
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

    // Export submenu items — all convert in the frontend and write a file
    // directly. PDF is a vector export here (the File > Print item, Cmd/Ctrl+P,
    // is the separate print-dialog path).
    let export_html = MenuItemBuilder::with_id("export-html", "HTML\u{2026}").build(handle)?;
    let export_docx =
        MenuItemBuilder::with_id("export-docx", "Word (DOCX)\u{2026}").build(handle)?;
    let export_epub = MenuItemBuilder::with_id("export-epub", "EPUB\u{2026}").build(handle)?;
    let export_pdf = MenuItemBuilder::with_id("export-pdf", "PDF\u{2026}").build(handle)?;

    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let close = MenuItemBuilder::with_id("close", "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(handle)?;
    let settings = MenuItemBuilder::with_id("open-settings", "Settings\u{2026}")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    // Cloud Sync is per-workspace; the modal handles the no-folder
    // case with an empty state, so the item is always enabled and a
    // first-time click teaches the user what it needs.
    let sync_settings =
        MenuItemBuilder::with_id("open-sync-settings", "Cloud Sync\u{2026}").build(handle)?;

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
    let command_palette =
        MenuItemBuilder::with_id("open-command-palette", "Command Palette\u{2026}")
            .accelerator("CmdOrCtrl+K")
            .build(handle)?;
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

    // DevTools menu item: only built into debug binaries so release builds
    // don't expose an "Open Developer Tools" affordance to end users.
    #[cfg(debug_assertions)]
    let toggle_devtools = MenuItemBuilder::with_id("toggle-devtools", "Toggle Developer Tools")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(handle)?;

    let view_menu = {
        let builder = SubmenuBuilder::new(handle, "View")
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
            .fullscreen();
        #[cfg(debug_assertions)]
        let builder = builder.separator().item(&toggle_devtools);
        builder.build()?
    };

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

    // Export submenu — shared between the macOS and Windows/Linux File menus.
    let export_menu = SubmenuBuilder::new(handle, "Export")
        .item(&export_html)
        .item(&export_docx)
        .item(&export_epub)
        .item(&export_pdf)
        .build()?;

    // macOS: Settings goes in app menu, File menu is simple
    #[cfg(target_os = "macos")]
    let menu = {
        let file_menu = SubmenuBuilder::new(handle, "File")
            .item(&open)
            .item(&open_folder)
            .separator()
            .item(&print)
            .item(&export_menu)
            .separator()
            .item(&sync_settings)
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
            .item(&export_menu)
            .separator()
            .item(&settings)
            .item(&sync_settings)
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
        open,
        open_folder,
        close_tab,
        print,
        export_html,
        export_docx,
        export_epub,
        export_pdf,
        find,
        command_palette,
        toggle_files_sidebar,
        toggle_outline_sidebar,
        toggle_edit,
        zoom_in,
        zoom_out,
        actual_size,
        settings,
        ai_summarize,
        ai_explain,
        ai_simplify,
        ai_read_aloud,
    };

    Ok((menu, refs))
}

/// Maps a bindable command id to its menu item, for accelerator updates.
fn accelerator_target<'a>(refs: &'a MenuItemRefs, id: &str) -> Option<&'a MenuItem<Wry>> {
    let item = match id {
        "open" => &refs.open,
        "open-folder" => &refs.open_folder,
        "print" => &refs.print,
        "close-tab" => &refs.close_tab,
        "find" => &refs.find,
        "open-command-palette" => &refs.command_palette,
        "toggle-files-sidebar" => &refs.toggle_files_sidebar,
        "toggle-outline-sidebar" => &refs.toggle_outline_sidebar,
        "toggle-edit" => &refs.toggle_edit,
        "zoom-in" => &refs.zoom_in,
        "zoom-out" => &refs.zoom_out,
        "actual-size" => &refs.actual_size,
        "open-settings" => &refs.settings,
        _ => return None,
    };
    Some(item)
}

/// Apply user-resolved accelerators to the native menu items. `bindings` maps a
/// command id to a Tauri accelerator string ("CmdOrCtrl+O"); unknown ids are
/// ignored. The frontend resolves defaults + overrides before calling this, so
/// the map is the full source of truth.
pub fn apply_keybindings_impl(
    refs: &MenuItemRefs,
    bindings: &HashMap<String, String>,
) -> Result<(), String> {
    for (id, accelerator) in bindings {
        if let Some(item) = accelerator_target(refs, id) {
            item.set_accelerator(Some(accelerator.as_str()))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn apply_keybindings(
    refs: State<MenuItemRefs>,
    bindings: HashMap<String, String>,
) -> Result<(), String> {
    apply_keybindings_impl(&refs, &bindings)
}

/// Apply enabled flags to every conditional menu item. Errors from individual
/// items are propagated as strings so the command can surface them.
pub fn apply_menu_state(refs: &MenuItemRefs, flags: &MenuStateFlags) -> Result<(), String> {
    let stringify = |e: tauri::Error| e.to_string();
    refs.close_tab
        .set_enabled(flags.has_tab)
        .map_err(stringify)?;
    refs.print.set_enabled(flags.has_file).map_err(stringify)?;
    refs.export_html
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    refs.export_docx
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    refs.export_epub
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    refs.export_pdf
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    refs.find.set_enabled(flags.has_file).map_err(stringify)?;
    refs.toggle_edit
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    let ai_enabled = flags.ai_configured && flags.has_content;
    refs.ai_summarize
        .set_enabled(ai_enabled)
        .map_err(stringify)?;
    refs.ai_explain.set_enabled(ai_enabled).map_err(stringify)?;
    refs.ai_simplify
        .set_enabled(ai_enabled)
        .map_err(stringify)?;
    refs.ai_read_aloud
        .set_enabled(flags.tts_available && flags.has_content)
        .map_err(stringify)?;
    Ok(())
}

#[tauri::command]
pub fn set_menu_state(refs: State<MenuItemRefs>, flags: MenuStateFlags) -> Result<(), String> {
    apply_menu_state(&refs, &flags)
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if let Some(action) = menu_action_for_id(event.id().as_ref()) {
        dispatch_menu_action(app, action);
    }
}
