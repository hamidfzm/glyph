// Installed-plugin discovery and installation. Plugins live as folders under
// `<app config dir>/plugins/<id>/`, each holding a `manifest.json` and a
// pre-built ESM entry file (default `main.js`). The frontend loads the entry
// source returned here via a dynamic module import; no plugin code runs in Rust.

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_http::reqwest;

use crate::grants::GrantRegistry;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Capabilities the plugin declares; shown to the user before install.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub permissions: Vec<String>,
    /// Run isolated in a worker instead of the app context. Always serialized
    /// so the frontend sees the resolved default (absent manifest flag = true),
    /// never re-derives it.
    pub sandbox: bool,
    /// Files the plugin consists of (entry + assets), as declared in the
    /// manifest. Empty for legacy two-file plugins (manifest + main only).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// Absolute path of the installed plugin folder.
    pub dir: String,
    /// Source text of the plugin's ESM entry file.
    pub main_source: String,
}

mod manifest;
mod registry;
mod store;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub(crate) use manifest::is_well_formed_id;

use registry::{
    find_entry, install_verified, is_marketplace_url, MAX_INDEX_BYTES, MAX_PACKAGE_BYTES,
    REGISTRY_URL,
};
use store::{inspect_dir, install_into, read_asset_from, scan_plugins_root, uninstall_from};

fn plugins_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("plugins"))
        .map_err(|e| format!("cannot resolve app config dir: {e}"))
}

#[tauri::command]
pub fn list_plugins<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<InstalledPlugin>, String> {
    Ok(scan_plugins_root(&plugins_root(&app)?))
}

/// Metadata of a picked-but-not-yet-installed plugin folder, shown on the
/// consent dialog before anything is copied.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInspection {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub permissions: Vec<String>,
    pub sandbox: bool,
}

/// Peek the manifest of the folder picked via `pick_plugin_dir` without
/// consuming the pending slot, so consent can show identity, sandbox mode,
/// and permissions before `install_plugin` runs.
#[tauri::command]
pub fn inspect_plugin(grants: tauri::State<'_, GrantRegistry>) -> Result<PluginInspection, String> {
    let src_dir = grants
        .peek_pending_plugin_dir()
        .ok_or("no plugin folder was picked")?;
    inspect_dir(&src_dir)
}

/// Install from the folder picked via `pick_plugin_dir`: the source is
/// consumed from the pending slot, never a webview-supplied argument.
#[tauri::command]
pub fn install_plugin<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    grants: tauri::State<'_, GrantRegistry>,
) -> Result<InstalledPlugin, String> {
    let src_dir = grants
        .take_pending_plugin_dir()
        .ok_or("no plugin folder was picked")?;
    install_into(&plugins_root(&app)?, &src_dir)
}

/// Install a marketplace plugin by id. The backend fetches the registry index
/// itself, downloads the package the entry names, and verifies the bytes
/// against the entry's hash before anything is written: the renderer never
/// supplies a URL, a hash, or package bytes.
#[tauri::command]
pub async fn install_plugin_from_registry<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<InstalledPlugin, String> {
    manifest::validate_id(&id)?;
    let root = plugins_root(&app)?;
    let client = marketplace_client()?;
    let index = download(&client, REGISTRY_URL, MAX_INDEX_BYTES).await?;
    let index =
        String::from_utf8(index).map_err(|_| String::from("the plugin registry is not UTF-8"))?;
    let entry = find_entry(&index, &id)?;
    let bytes = download(&client, &entry.package_url, MAX_PACKAGE_BYTES).await?;
    tauri::async_runtime::spawn_blocking(move || install_verified(&root, &entry, &bytes))
        .await
        .map_err(|e| format!("plugin install task failed: {e}"))?
}

/// An HTTP client that follows a redirect only onto another marketplace host,
/// the way the http capability scoped the renderer's download before.
fn marketplace_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if is_marketplace_url(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.error("redirect leaves the marketplace hosts")
            }
        }))
        .build()
        .map_err(|e| format!("cannot build the download client: {e}"))
}

/// Fetch `url` into memory, refusing a body over `cap` bytes as it streams.
async fn download(client: &reqwest::Client, url: &str, cap: usize) -> Result<Vec<u8>, String> {
    if !is_marketplace_url(url) {
        return Err(format!("{url} is outside the marketplace hosts"));
    }
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download failed: {e}"))?
    {
        if bytes.len() + chunk.len() > cap {
            return Err(format!("download of {url} exceeds the size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub fn read_plugin_asset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    read_asset_from(&plugins_root(&app)?, &id, &path)
}

#[tauri::command]
pub fn uninstall_plugin<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    uninstall_from(&plugins_root(&app)?, &id)
}
