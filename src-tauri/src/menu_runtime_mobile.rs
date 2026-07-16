//! Mobile stand-ins for the desktop menu commands.
//!
//! Mobile has no native menu bar (`tauri::menu` is desktop-only), but the
//! frontend pushes menu state, keybindings, and labels unconditionally on
//! mount. These accept and drop the payloads so those invokes succeed.

#[tauri::command]
pub fn apply_keybindings(_bindings: serde_json::Value) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn set_menu_state(_flags: serde_json::Value) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn set_menu_labels(_labels: serde_json::Value) -> Result<(), String> {
    Ok(())
}
