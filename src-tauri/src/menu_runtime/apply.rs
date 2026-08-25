//! Runtime mutations of an already-built menu: accelerators, enabled state,
//! and localized labels, plus the Tauri commands the frontend calls.

use std::collections::HashMap;

use tauri::{menu::MenuItem, Runtime, State};

use super::{MenuItemRefs, MenuLabels, MenuRegistry, MenuStateFlags};

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
        "search-workspace" => &refs.search_workspace,
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
fn apply_keybindings_impl<R: Runtime>(
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
    refs.save.set_enabled(flags.has_dirty).map_err(stringify)?;
    refs.auto_save
        .set_checked(flags.auto_save)
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
    refs.search_workspace
        .set_enabled(flags.has_workspace)
        .map_err(stringify)?;
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
    refs.new_document.set_text(&l.new_document).map_err(s)?;
    refs.open.set_text(&l.open).map_err(s)?;
    refs.open_folder.set_text(&l.open_folder).map_err(s)?;
    refs.save.set_text(&l.save).map_err(s)?;
    refs.auto_save.set_text(&l.auto_save).map_err(s)?;
    refs.new_workspace.set_text(&l.new_workspace).map_err(s)?;
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
    refs.manage_plugins.set_text(&l.manage_plugins).map_err(s)?;
    refs.find.set_text(&l.find).map_err(s)?;
    refs.search_workspace
        .set_text(&l.search_workspace)
        .map_err(s)?;
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

/// Whether the window's outer bounds actually cover its monitor. tao's
/// `is_fullscreen` only echoes a cached flag, which diverges when the resize
/// itself is lost (see below), so verification must measure the real window.
#[cfg(not(target_os = "macos"))]
fn covers_monitor(window: &tauri::WebviewWindow) -> bool {
    match (window.outer_size(), window.current_monitor()) {
        (Ok(size), Ok(Some(monitor))) => {
            size.width >= monitor.size().width && size.height >= monitor.size().height
        }
        // Can't measure: treat as applied rather than retry forever.
        _ => true,
    }
}

// Fullscreen for the image lightbox, with the in-window menu bar (Windows/
// Linux) hidden while fullscreen. Entering hides the menu before the
// transition so the bar never flashes over the fullscreen window. On Windows
// the fullscreen resize is applied with SWP_ASYNCWINDOWPOS and can lose the
// race against the menu change's frame recalculation; tao then caches
// "fullscreen" with the window never resized and early-returns every later
// request. The verify-retry below heals exactly that: it measures the real
// bounds against the monitor and clears + re-applies until they match.
#[tauri::command]
pub fn set_lightbox_fullscreen(window: tauri::WebviewWindow, enter: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // The macOS menu lives in the system bar and fullscreen hides it.
        window.set_fullscreen(enter).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let w = window.clone();
        std::thread::spawn(move || {
            if enter {
                // A minimized window is iconic: resizes apply to nothing.
                let _ = w.unminimize();
                let _ = w.hide_menu();
                for _ in 0..3 {
                    let _ = w.set_fullscreen(false);
                    let _ = w.set_fullscreen(true);
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    if covers_monitor(&w) {
                        break;
                    }
                }
            } else {
                let _ = w.set_fullscreen(false);
                std::thread::sleep(std::time::Duration::from_millis(150));
                let _ = w.show_menu();
            }
        });
        Ok(())
    }
}
