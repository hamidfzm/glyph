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
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder},
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
    reset_view: MenuItem<Wry>,
    close_tab: MenuItem<Wry>,
    close: MenuItem<Wry>,
    print: MenuItem<Wry>,
    export_html: MenuItem<Wry>,
    export_docx: MenuItem<Wry>,
    export_epub: MenuItem<Wry>,
    export_pdf: MenuItem<Wry>,
    export_website: MenuItem<Wry>,
    find: MenuItem<Wry>,
    command_palette: MenuItem<Wry>,
    toggle_files_sidebar: MenuItem<Wry>,
    toggle_outline_sidebar: MenuItem<Wry>,
    toggle_edit: MenuItem<Wry>,
    open_graph: MenuItem<Wry>,
    zoom_in: MenuItem<Wry>,
    zoom_out: MenuItem<Wry>,
    actual_size: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    sync_settings: MenuItem<Wry>,
    ai_chat: MenuItem<Wry>,
    ai_summarize: MenuItem<Wry>,
    ai_explain: MenuItem<Wry>,
    ai_simplify: MenuItem<Wry>,
    ai_read_aloud: MenuItem<Wry>,
    documentation: MenuItem<Wry>,
    release_notes: MenuItem<Wry>,
    report_issue: MenuItem<Wry>,
    // Submenu handles, kept so their titles can be re-localized at runtime.
    file_menu: Submenu<Wry>,
    edit_menu: Submenu<Wry>,
    view_menu: Submenu<Wry>,
    ai_menu: Submenu<Wry>,
    help_menu: Submenu<Wry>,
    export_menu: Submenu<Wry>,
}

/// Localized labels for every Glyph-defined menu entry. Pushed from the
/// frontend (which owns the translations) via `set_menu_labels` whenever the
/// UI locale changes. OS-provided items (Copy, Quit, About, Fullscreen, …) are
/// localized by the platform, so they're absent here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuLabels {
    file: String,
    edit: String,
    view: String,
    ai: String,
    help: String,
    export: String,
    open: String,
    open_folder: String,
    reset_view: String,
    print: String,
    export_html: String,
    export_docx: String,
    export_epub: String,
    export_pdf: String,
    export_website: String,
    close_tab: String,
    close: String,
    settings: String,
    sync_settings: String,
    find: String,
    command_palette: String,
    toggle_files_sidebar: String,
    toggle_outline_sidebar: String,
    zoom_in: String,
    zoom_out: String,
    actual_size: String,
    toggle_edit: String,
    open_graph: String,
    ai_chat: String,
    ai_summarize: String,
    ai_explain: String,
    ai_simplify: String,
    ai_read_aloud: String,
    documentation: String,
    release_notes: String,
    report_issue: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuStateFlags {
    pub has_tab: bool,
    pub has_file: bool,
    pub has_content: bool,
    pub has_workspace: bool,
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
    // Whole-workspace static site export; gated on has_workspace, unlike the
    // single-document items above which need an open file.
    let export_website =
        MenuItemBuilder::with_id("export-website", "Website\u{2026}").build(handle)?;

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

    // Workspace graph view; only meaningful with a folder workspace open, so
    // it's gated by `has_workspace` in apply_menu_state.
    let open_graph = MenuItemBuilder::with_id("open-graph", "Open Graph")
        .accelerator("CmdOrCtrl+G")
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
            .item(&open_graph)
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
    let ai_chat = MenuItemBuilder::with_id("ai-chat", "AI Chat")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(handle)?;
    let ai_summarize =
        MenuItemBuilder::with_id("ai-summarize", "Summarize Document").build(handle)?;
    let ai_explain = MenuItemBuilder::with_id("ai-explain", "Explain Document").build(handle)?;
    let ai_simplify = MenuItemBuilder::with_id("ai-simplify", "Simplify Document").build(handle)?;
    let ai_read_aloud = MenuItemBuilder::with_id("ai-read-aloud", "Read Aloud").build(handle)?;

    let ai_menu = SubmenuBuilder::new(handle, "AI")
        .item(&ai_chat)
        .separator()
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

    // Help menu external links, always enabled. Each emits a menu event the
    // frontend handles by opening the URL via the opener plugin.
    let documentation = MenuItemBuilder::with_id("documentation", "Documentation").build(handle)?;
    let release_notes = MenuItemBuilder::with_id("release-notes", "Release Notes").build(handle)?;
    let report_issue = MenuItemBuilder::with_id("report-issue", "Report an Issue").build(handle)?;

    // Help menu
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&documentation)
        .item(&release_notes)
        .separator()
        .item(&report_issue)
        .separator()
        .about(Some(about_metadata.clone()))
        .build()?;

    // Export submenu — shared between the macOS and Windows/Linux File menus.
    let export_menu = SubmenuBuilder::new(handle, "Export")
        .item(&export_html)
        .item(&export_docx)
        .item(&export_epub)
        .item(&export_pdf)
        .separator()
        .item(&export_website)
        .build()?;

    // macOS: Settings goes in app menu, File menu is simple
    #[cfg(target_os = "macos")]
    let (menu, file_menu) = {
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

        let menu = MenuBuilder::new(handle)
            .item(&app_menu)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&ai_menu)
            .item(&help_menu)
            .build()?;
        (menu, file_menu)
    };

    // Windows/Linux: Settings goes in File menu
    #[cfg(not(target_os = "macos"))]
    let (menu, file_menu) = {
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

        let menu = MenuBuilder::new(handle)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&ai_menu)
            .item(&help_menu)
            .build()?;
        (menu, file_menu)
    };

    let refs = MenuItemRefs {
        open,
        open_folder,
        reset_view,
        close_tab,
        close,
        print,
        export_html,
        export_docx,
        export_epub,
        export_pdf,
        export_website,
        find,
        command_palette,
        toggle_files_sidebar,
        toggle_outline_sidebar,
        toggle_edit,
        open_graph,
        zoom_in,
        zoom_out,
        actual_size,
        settings,
        sync_settings,
        ai_chat,
        ai_summarize,
        ai_explain,
        ai_simplify,
        ai_read_aloud,
        documentation,
        release_notes,
        report_issue,
        file_menu,
        edit_menu,
        view_menu,
        ai_menu,
        help_menu,
        export_menu,
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
        "close" => &refs.close,
        "find" => &refs.find,
        "open-command-palette" => &refs.command_palette,
        "toggle-files-sidebar" => &refs.toggle_files_sidebar,
        "toggle-outline-sidebar" => &refs.toggle_outline_sidebar,
        "toggle-edit" => &refs.toggle_edit,
        "open-graph" => &refs.open_graph,
        "ai-chat" => &refs.ai_chat,
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
    refs.export_website
        .set_enabled(flags.has_workspace)
        .map_err(stringify)?;
    refs.find.set_enabled(flags.has_file).map_err(stringify)?;
    refs.toggle_edit
        .set_enabled(flags.has_file)
        .map_err(stringify)?;
    refs.open_graph
        .set_enabled(flags.has_workspace)
        .map_err(stringify)?;
    // Chat works with or without an open document, so it only needs a provider.
    refs.ai_chat
        .set_enabled(flags.ai_configured)
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

/// Re-label every Glyph-defined menu item and submenu title in place via
/// `set_text` — no menu rebuild, so item handles and accelerators stay valid.
/// The frontend calls this with translated strings whenever the locale changes.
pub fn apply_menu_labels(refs: &MenuItemRefs, l: &MenuLabels) -> Result<(), String> {
    let s = |e: tauri::Error| e.to_string();
    refs.file_menu.set_text(&l.file).map_err(s)?;
    refs.edit_menu.set_text(&l.edit).map_err(s)?;
    refs.view_menu.set_text(&l.view).map_err(s)?;
    refs.ai_menu.set_text(&l.ai).map_err(s)?;
    refs.help_menu.set_text(&l.help).map_err(s)?;
    refs.export_menu.set_text(&l.export).map_err(s)?;
    refs.open.set_text(&l.open).map_err(s)?;
    refs.open_folder.set_text(&l.open_folder).map_err(s)?;
    refs.reset_view.set_text(&l.reset_view).map_err(s)?;
    refs.print.set_text(&l.print).map_err(s)?;
    refs.export_html.set_text(&l.export_html).map_err(s)?;
    refs.export_docx.set_text(&l.export_docx).map_err(s)?;
    refs.export_epub.set_text(&l.export_epub).map_err(s)?;
    refs.export_pdf.set_text(&l.export_pdf).map_err(s)?;
    refs.export_website.set_text(&l.export_website).map_err(s)?;
    refs.close_tab.set_text(&l.close_tab).map_err(s)?;
    refs.close.set_text(&l.close).map_err(s)?;
    refs.settings.set_text(&l.settings).map_err(s)?;
    refs.sync_settings.set_text(&l.sync_settings).map_err(s)?;
    refs.find.set_text(&l.find).map_err(s)?;
    refs.command_palette
        .set_text(&l.command_palette)
        .map_err(s)?;
    refs.toggle_files_sidebar
        .set_text(&l.toggle_files_sidebar)
        .map_err(s)?;
    refs.toggle_outline_sidebar
        .set_text(&l.toggle_outline_sidebar)
        .map_err(s)?;
    refs.zoom_in.set_text(&l.zoom_in).map_err(s)?;
    refs.zoom_out.set_text(&l.zoom_out).map_err(s)?;
    refs.actual_size.set_text(&l.actual_size).map_err(s)?;
    refs.toggle_edit.set_text(&l.toggle_edit).map_err(s)?;
    refs.open_graph.set_text(&l.open_graph).map_err(s)?;
    refs.ai_chat.set_text(&l.ai_chat).map_err(s)?;
    refs.ai_summarize.set_text(&l.ai_summarize).map_err(s)?;
    refs.ai_explain.set_text(&l.ai_explain).map_err(s)?;
    refs.ai_simplify.set_text(&l.ai_simplify).map_err(s)?;
    refs.ai_read_aloud.set_text(&l.ai_read_aloud).map_err(s)?;
    refs.documentation.set_text(&l.documentation).map_err(s)?;
    refs.release_notes.set_text(&l.release_notes).map_err(s)?;
    refs.report_issue.set_text(&l.report_issue).map_err(s)?;
    Ok(())
}

#[tauri::command]
pub fn set_menu_labels(refs: State<MenuItemRefs>, labels: MenuLabels) -> Result<(), String> {
    apply_menu_labels(&refs, &labels)
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if let Some(action) = menu_action_for_id(event.id().as_ref()) {
        dispatch_menu_action(app, action);
    }
}
