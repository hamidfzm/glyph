//! Construction of the native menu tree. Split from the runtime's state
//! mutations so each file covers one job; both need private access to
//! [`super::MenuItemRefs`], hence the child-module layout.

use tauri::{
    menu::{
        AboutMetadataBuilder, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
    },
    AppHandle, Runtime,
};

use super::MenuItemRefs;

/// Build the full menu. With `owner: Some(label)` (per-window menus on
/// Windows) every item id is prefixed `label:` so menu events route to the
/// owning window by id instead of by focus, which is unreliable while the
/// Win32 menu loop is closing. `None` keeps bare ids (shared app menu).
pub fn build_menu<R: Runtime>(
    handle: &AppHandle<R>,
    owner: Option<&str>,
) -> tauri::Result<(tauri::menu::Menu<R>, MenuItemRefs<R>)> {
    let mid = |base: &str| -> String {
        match owner {
            Some(label) => format!("{label}:{base}"),
            None => base.to_string(),
        }
    };

    // Shared menu items
    let new_document = MenuItemBuilder::with_id(mid("new"), "New")
        .accelerator("CmdOrCtrl+N")
        .build(handle)?;
    let open = MenuItemBuilder::with_id(mid("open"), "Open\u{2026}")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let open_folder = MenuItemBuilder::with_id(mid("open-folder"), "Open Folder\u{2026}")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(handle)?;
    let new_workspace =
        MenuItemBuilder::with_id(mid("new-workspace"), "New Workspace\u{2026}").build(handle)?;
    let reset_view = MenuItemBuilder::with_id(mid("reset-view"), "Reset View").build(handle)?;
    let save = MenuItemBuilder::with_id(mid("save"), "Save")
        .accelerator("CmdOrCtrl+S")
        .build(handle)?;
    // Built checked (default-on); set_menu_state corrects it on mount.
    let auto_save = CheckMenuItemBuilder::with_id(mid("toggle-auto-save"), "Auto Save")
        .checked(true)
        .build(handle)?;
    let print = MenuItemBuilder::with_id(mid("print"), "Print\u{2026}")
        .accelerator("CmdOrCtrl+P")
        .build(handle)?;

    // Export submenu items — all convert in the frontend and write a file
    // directly. PDF is a vector export here (the File > Print item, Cmd/Ctrl+P,
    // is the separate print-dialog path).
    let export_html = MenuItemBuilder::with_id(mid("export-html"), "HTML\u{2026}").build(handle)?;
    let export_docx =
        MenuItemBuilder::with_id(mid("export-docx"), "Word (DOCX)\u{2026}").build(handle)?;
    let export_epub = MenuItemBuilder::with_id(mid("export-epub"), "EPUB\u{2026}").build(handle)?;
    let export_pdf = MenuItemBuilder::with_id(mid("export-pdf"), "PDF\u{2026}").build(handle)?;
    // Whole-workspace static site export; gated on has_workspace, unlike the
    // single-document items above which need an open file.
    let export_website =
        MenuItemBuilder::with_id(mid("export-website"), "Website\u{2026}").build(handle)?;
    // Per-workspace settings dialog (stored in the workspace's .glyph folder),
    // as opposed to the global Settings item; also gated on has_workspace.
    let workspace_settings =
        MenuItemBuilder::with_id(mid("workspace-settings"), "Workspace Settings\u{2026}")
            .build(handle)?;

    let close_tab = MenuItemBuilder::with_id(mid("close-tab"), "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    // Gated on has_workspace in apply_menu_state; leaves loose files open.
    let close_workspace =
        MenuItemBuilder::with_id(mid("close-workspace"), "Close Workspace").build(handle)?;
    let close = MenuItemBuilder::with_id(mid("close"), "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(handle)?;
    let settings = MenuItemBuilder::with_id(mid("open-settings"), "Settings\u{2026}")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    let manage_plugins =
        MenuItemBuilder::with_id(mid("manage-plugins"), "Plugins\u{2026}").build(handle)?;

    // Edit menu
    let find = MenuItemBuilder::with_id(mid("find"), "Find\u{2026}")
        .accelerator("CmdOrCtrl+F")
        .build(handle)?;

    // macOS routes Cmd+X/C/V/A to the WebView through these predefined items'
    // key equivalents, so a missing item silently kills the shortcut in the
    // editor. Undo/redo stay out: the editor owns Cmd+Z through its own
    // history, and a native item would claim the key equivalent from it.
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    // View menu
    let command_palette =
        MenuItemBuilder::with_id(mid("open-command-palette"), "Command Palette\u{2026}")
            .accelerator("CmdOrCtrl+K")
            .build(handle)?;
    let toggle_files_sidebar =
        MenuItemBuilder::with_id(mid("toggle-files-sidebar"), "Toggle Files Sidebar")
            .accelerator("CmdOrCtrl+B")
            .build(handle)?;
    let toggle_outline_sidebar =
        MenuItemBuilder::with_id(mid("toggle-outline-sidebar"), "Toggle Outline Sidebar")
            .accelerator("CmdOrCtrl+\\")
            .build(handle)?;

    let zoom_in = MenuItemBuilder::with_id(mid("zoom-in"), "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(handle)?;
    let zoom_out = MenuItemBuilder::with_id(mid("zoom-out"), "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(handle)?;
    let actual_size = MenuItemBuilder::with_id(mid("actual-size"), "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(handle)?;

    let toggle_edit = MenuItemBuilder::with_id(mid("toggle-edit"), "Toggle Edit Mode")
        .accelerator("CmdOrCtrl+E")
        .build(handle)?;

    // Workspace graph view; only meaningful with a folder workspace open, so
    // it's gated by `has_workspace` in apply_menu_state.
    let open_graph = MenuItemBuilder::with_id(mid("open-graph"), "Open Graph")
        .accelerator("CmdOrCtrl+G")
        .build(handle)?;

    // DevTools menu item: only built into debug binaries so release builds
    // don't expose an "Open Developer Tools" affordance to end users.
    #[cfg(debug_assertions)]
    let toggle_devtools =
        MenuItemBuilder::with_id(mid("toggle-devtools"), "Toggle Developer Tools")
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
    let ai_chat = MenuItemBuilder::with_id(mid("ai-chat"), "AI Chat")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(handle)?;
    let ai_summarize =
        MenuItemBuilder::with_id(mid("ai-summarize"), "Summarize Document").build(handle)?;
    let ai_explain =
        MenuItemBuilder::with_id(mid("ai-explain"), "Explain Document").build(handle)?;
    let ai_simplify =
        MenuItemBuilder::with_id(mid("ai-simplify"), "Simplify Document").build(handle)?;
    let ai_read_aloud =
        MenuItemBuilder::with_id(mid("ai-read-aloud"), "Read Aloud").build(handle)?;

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
    let documentation =
        MenuItemBuilder::with_id(mid("documentation"), "Documentation").build(handle)?;
    let release_notes =
        MenuItemBuilder::with_id(mid("release-notes"), "Release Notes").build(handle)?;
    let report_issue =
        MenuItemBuilder::with_id(mid("report-issue"), "Report an Issue").build(handle)?;

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
            .item(&new_document)
            .item(&open)
            .item(&open_folder)
            .item(&new_workspace)
            .separator()
            .item(&save)
            .item(&auto_save)
            .separator()
            .item(&print)
            .item(&export_menu)
            .separator()
            .item(&workspace_settings)
            .separator()
            .item(&close_tab)
            .item(&close_workspace)
            .item(&close)
            .build()?;

        let app_menu = SubmenuBuilder::new(handle, "Glyph")
            .about(Some(about_metadata))
            .separator()
            .item(&settings)
            .item(&manage_plugins)
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
            .item(&new_document)
            .item(&open)
            .item(&open_folder)
            .item(&new_workspace)
            .separator()
            .item(&save)
            .item(&auto_save)
            .separator()
            .item(&print)
            .item(&export_menu)
            .separator()
            .item(&settings)
            .item(&workspace_settings)
            .item(&manage_plugins)
            .separator()
            .item(&close_tab)
            .item(&close_workspace)
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
        new_document,
        open,
        open_folder,
        save,
        auto_save,
        new_workspace,
        reset_view,
        close_tab,
        close_workspace,
        close,
        print,
        export_html,
        export_docx,
        export_epub,
        export_pdf,
        export_website,
        workspace_settings,
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
        manage_plugins,
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
