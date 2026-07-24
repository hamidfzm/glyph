//! Native file/folder pickers run in Rust: the webview never supplies a path;
//! the user's choice is minted as a grant in [`GrantRegistry`]. Dialogs run on
//! a blocking thread (the plugin's blocking API must not run on the async
//! runtime). Drives live OS dialogs, so excluded from codecov (see codecov.yml).

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::grants::{self, GrantRegistry};

/// File-open filter entry, mirroring the JS dialog plugin's shape.
#[derive(Deserialize)]
pub struct PickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn to_path(picked: FilePath) -> Result<PathBuf, String> {
    picked.into_path().map_err(|e| e.to_string())
}

/// Open Folder: pick a directory and grant it as a workspace.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    let canonical = app.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(&app, &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// New Workspace: name a folder via a save dialog, create it, grant it as a
/// workspace. The create must precede the grant (grant_workspace needs it to exist).
#[tauri::command]
pub async fn pick_new_workspace<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_file_name(default_name);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let canonical = app.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(&app, &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Open File(s): multi-select picker; each choice is granted as a loose file.
#[tauri::command]
pub async fn pick_files<R: Runtime>(
    app: AppHandle<R>,
    filters: Vec<PickFilter>,
) -> Result<Option<Vec<String>>, String> {
    let mut dialog = app.dialog().file();
    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let grants = app.state::<GrantRegistry>();
    let mut paths = Vec::with_capacity(picked.len());
    for file in picked {
        let path = to_path(file)?;
        let canonical = grants.grant_file(&path)?;
        grants::allow_asset_file(&app, &canonical);
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(Some(paths))
}

/// Export save dialog: pick a destination file and grant it write-only.
#[tauri::command]
pub async fn pick_save<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let dialog = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, &exts);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    app.state::<GrantRegistry>().grant_export_file(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Website export: pick an output directory and grant it write-only.
#[tauri::command]
pub async fn pick_export_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    app.state::<GrantRegistry>().grant_export_dir(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Plugin install: the pick is stashed as the pending plugin dir (not a
/// workspace grant) and consumed by `install_plugin`.
#[tauri::command]
pub async fn pick_plugin_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    app.state::<GrantRegistry>()
        .set_pending_plugin_dir(path.clone());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// "Move to..." destination picker. No grant is minted; `move_path`
/// independently validates the destination against the workspace root.
#[tauri::command]
pub async fn pick_move_dir<R: Runtime>(
    app: AppHandle<R>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    match picked {
        Some(picked) => Ok(Some(to_path(picked)?.to_string_lossy().to_string())),
        None => Ok(None),
    }
}
