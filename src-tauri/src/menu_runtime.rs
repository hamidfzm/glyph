// Tauri-runtime menu wiring. Everything in this file directly drives the
// native menu manager (build_menu) or fires inside a Tauri-delivered
// MenuEvent (handle_menu_event), so it cannot be exercised from a
// `MockRuntime` unit test. The testable halves of the menu pipeline
// (`MenuAction`, `menu_action_for_id`, `dispatch_menu_action`) live in
// [`crate::menu`] and have direct tests there; this file is excluded from
// codecov so it doesn't drag the patch coverage down.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle, Runtime, State, Wry,
};

use crate::menu::{dispatch_menu_action, menu_action_for_id};

/// Handles to the menu items whose enabled state or accelerator changes at
/// runtime. Held per window in the [`MenuRegistry`] so the `set_menu_state`
/// and `apply_keybindings` commands can mutate the calling window's menu.
pub struct MenuItemRefs<R: Runtime = Wry> {
    open: MenuItem<R>,
    open_folder: MenuItem<R>,
    reset_view: MenuItem<R>,
    close_tab: MenuItem<R>,
    close_workspace: MenuItem<R>,
    close: MenuItem<R>,
    print: MenuItem<R>,
    export_html: MenuItem<R>,
    export_docx: MenuItem<R>,
    export_epub: MenuItem<R>,
    export_pdf: MenuItem<R>,
    export_website: MenuItem<R>,
    workspace_settings: MenuItem<R>,
    find: MenuItem<R>,
    command_palette: MenuItem<R>,
    toggle_files_sidebar: MenuItem<R>,
    toggle_outline_sidebar: MenuItem<R>,
    toggle_edit: MenuItem<R>,
    open_graph: MenuItem<R>,
    zoom_in: MenuItem<R>,
    zoom_out: MenuItem<R>,
    actual_size: MenuItem<R>,
    settings: MenuItem<R>,
    sync_settings: MenuItem<R>,
    manage_plugins: MenuItem<R>,
    ai_chat: MenuItem<R>,
    ai_summarize: MenuItem<R>,
    ai_explain: MenuItem<R>,
    ai_simplify: MenuItem<R>,
    ai_read_aloud: MenuItem<R>,
    documentation: MenuItem<R>,
    release_notes: MenuItem<R>,
    report_issue: MenuItem<R>,
    // Submenu handles, kept so their titles can be re-localized at runtime.
    file_menu: Submenu<R>,
    edit_menu: Submenu<R>,
    view_menu: Submenu<R>,
    ai_menu: Submenu<R>,
    help_menu: Submenu<R>,
    export_menu: Submenu<R>,
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
    workspace_settings: String,
    close_tab: String,
    close_workspace: String,
    close: String,
    settings: String,
    sync_settings: String,
    manage_plugins: String,
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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuStateFlags {
    pub has_tab: bool,
    pub has_file: bool,
    pub has_content: bool,
    pub has_workspace: bool,
    pub ai_configured: bool,
    pub tts_available: bool,
}

/// Per-window menu handles, keyed by window label. Windows cannot share one
/// native menu across windows (a Win32 HMENU attaches to a single window), so
/// each spawned window owns a full menu instance; commands resolve the calling
/// window's refs here and fall back to `main` on platforms with one app menu.
pub struct MenuRegistry<R: Runtime = Wry>(Mutex<HashMap<String, MenuItemRefs<R>>>);

impl<R: Runtime> MenuRegistry<R> {
    pub fn with_main(refs: MenuItemRefs<R>) -> Self {
        Self(Mutex::new(HashMap::from([("main".to_string(), refs)])))
    }

    pub fn insert(&self, label: &str, refs: MenuItemRefs<R>) {
        self.0.lock().unwrap().insert(label.to_string(), refs);
    }

    pub fn remove(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }

    /// Run `f` against the refs for `label`, falling back to `main` (platforms
    /// with one app-wide menu). Returns None when neither exists (teardown).
    fn with_refs<T>(&self, label: &str, f: impl FnOnce(&MenuItemRefs<R>) -> T) -> Option<T> {
        let map = self.0.lock().unwrap();
        map.get(label).or_else(|| map.get("main")).map(f)
    }
}

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
    let open = MenuItemBuilder::with_id(mid("open"), "Open\u{2026}")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let open_folder = MenuItemBuilder::with_id(mid("open-folder"), "Open Folder\u{2026}")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(handle)?;
    let reset_view = MenuItemBuilder::with_id(mid("reset-view"), "Reset View").build(handle)?;
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
    // Cloud Sync is per-workspace; the modal handles the no-folder
    // case with an empty state, so the item is always enabled and a
    // first-time click teaches the user what it needs.
    let sync_settings =
        MenuItemBuilder::with_id(mid("open-sync-settings"), "Cloud Sync\u{2026}").build(handle)?;
    let manage_plugins =
        MenuItemBuilder::with_id(mid("manage-plugins"), "Plugins\u{2026}").build(handle)?;

    // Edit menu
    let find = MenuItemBuilder::with_id(mid("find"), "Find\u{2026}")
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
            .item(&open)
            .item(&open_folder)
            .separator()
            .item(&print)
            .item(&export_menu)
            .separator()
            .item(&workspace_settings)
            .item(&sync_settings)
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
            .item(&open)
            .item(&open_folder)
            .separator()
            .item(&print)
            .item(&export_menu)
            .separator()
            .item(&settings)
            .item(&workspace_settings)
            .item(&manage_plugins)
            .item(&sync_settings)
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
        open,
        open_folder,
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
        sync_settings,
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

/// Maps a bindable command id to its menu item, for accelerator updates.
fn accelerator_target<'a, R: Runtime>(
    refs: &'a MenuItemRefs<R>,
    id: &str,
) -> Option<&'a MenuItem<R>> {
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
pub fn apply_keybindings_impl<R: Runtime>(
    refs: &MenuItemRefs<R>,
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
    window: tauri::WebviewWindow,
    registry: State<MenuRegistry>,
    bindings: HashMap<String, String>,
) -> Result<(), String> {
    // A missing entry means the window is mid-teardown; nothing to update.
    registry
        .with_refs(window.label(), |refs| {
            apply_keybindings_impl(refs, &bindings)
        })
        .unwrap_or(Ok(()))
}

/// Apply enabled flags to every conditional menu item. Errors from individual
/// items are propagated as strings so the command can surface them.
pub fn apply_menu_state<R: Runtime>(
    refs: &MenuItemRefs<R>,
    flags: &MenuStateFlags,
) -> Result<(), String> {
    let stringify = |e: tauri::Error| e.to_string();
    refs.close_tab
        .set_enabled(flags.has_tab)
        .map_err(stringify)?;
    refs.close_workspace
        .set_enabled(flags.has_workspace)
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
    refs.workspace_settings
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
pub fn set_menu_state(
    window: tauri::WebviewWindow,
    registry: State<MenuRegistry>,
    flags: MenuStateFlags,
) -> Result<(), String> {
    registry
        .with_refs(window.label(), |refs| apply_menu_state(refs, &flags))
        .unwrap_or(Ok(()))
}

/// Re-label every Glyph-defined menu item and submenu title in place via
/// `set_text` — no menu rebuild, so item handles and accelerators stay valid.
/// The frontend calls this with translated strings whenever the locale changes.
pub fn apply_menu_labels<R: Runtime>(refs: &MenuItemRefs<R>, l: &MenuLabels) -> Result<(), String> {
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
    refs.workspace_settings
        .set_text(&l.workspace_settings)
        .map_err(s)?;
    refs.close_tab.set_text(&l.close_tab).map_err(s)?;
    refs.close_workspace
        .set_text(&l.close_workspace)
        .map_err(s)?;
    refs.close.set_text(&l.close).map_err(s)?;
    refs.settings.set_text(&l.settings).map_err(s)?;
    refs.sync_settings.set_text(&l.sync_settings).map_err(s)?;
    refs.manage_plugins.set_text(&l.manage_plugins).map_err(s)?;
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
pub fn set_menu_labels(
    window: tauri::WebviewWindow,
    registry: State<MenuRegistry>,
    labels: MenuLabels,
) -> Result<(), String> {
    registry
        .with_refs(window.label(), |refs| apply_menu_labels(refs, &labels))
        .unwrap_or(Ok(()))
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let (owner, base) = crate::menu::parse_menu_id(event.id().as_ref());
    if let Some(action) = menu_action_for_id(base) {
        // Per-window menus carry their owner in the id; bare ids (shared app
        // menu) fall back to the focused window.
        let label = match owner {
            Some(label) => label.to_string(),
            None => crate::windows_runtime::current_window_label(app),
        };
        dispatch_menu_action(app, &label, action);
    }
}
