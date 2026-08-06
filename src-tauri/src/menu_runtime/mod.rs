// Tauri-runtime menu wiring. Everything in this file directly drives the
// native menu manager (build_menu) or fires inside a Tauri-delivered
// MenuEvent (handle_menu_event), so it cannot be exercised from a
// `MockRuntime` unit test. The testable halves of the menu pipeline
// (`MenuAction`, `menu_action_for_id`, `dispatch_menu_action`) live in
// [`crate::menu`] and have direct tests there; this file is excluded from
// codecov so it doesn't drag the patch coverage down.

pub mod apply;
mod builder;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, MenuItem, Submenu},
    Runtime, Wry,
};

use crate::menu::{dispatch_menu_action, menu_action_for_id};

// The `#[tauri::command]` entry points stay behind `apply::` so
// `generate_handler!` can reach the items the attribute expands alongside them.
pub use apply::apply_menu_state;
pub use builder::build_menu;

/// Handles to the menu items whose enabled state or accelerator changes at
/// runtime. Held per window in the [`MenuRegistry`] so the `set_menu_state`
/// and `apply_keybindings` commands can mutate the calling window's menu.
pub struct MenuItemRefs<R: Runtime = Wry> {
    new_document: MenuItem<R>,
    open: MenuItem<R>,
    open_folder: MenuItem<R>,
    save: MenuItem<R>,
    auto_save: CheckMenuItem<R>,
    new_workspace: MenuItem<R>,
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
    new_document: String,
    edit: String,
    view: String,
    ai: String,
    help: String,
    export: String,
    open: String,
    open_folder: String,
    save: String,
    auto_save: String,
    new_workspace: String,
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
    pub has_dirty: bool,
    pub auto_save: bool,
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

    // Spawned windows get their own menu only on Windows (see spawn_window).
    #[cfg(windows)]
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
