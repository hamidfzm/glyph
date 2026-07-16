//! Mobile stub for `pick.rs`: the blocking pickers are desktop-only and the
//! mobile UI never offers these flows. Answering the same commands keeps one
//! `generate_handler!` list serving both targets; every picker returns None.

use serde::Deserialize;
use tauri::{AppHandle, Runtime};

/// Mirrors `pick::PickFilter` so the command signatures stay identical.
#[derive(Deserialize)]
pub struct PickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[tauri::command]
pub async fn pick_folder<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn pick_files<R: Runtime>(
    _app: AppHandle<R>,
    filters: Vec<PickFilter>,
) -> Result<Option<Vec<String>>, String> {
    Ok(None)
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn pick_save<R: Runtime>(
    _app: AppHandle<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn pick_export_dir<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn pick_plugin_dir<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn pick_move_dir<R: Runtime>(
    _app: AppHandle<R>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    Ok(None)
}
