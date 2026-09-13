//! The Tauri surface over [`Vault`]. Every command checks the grant registry
//! before the core touches the filesystem; the core itself takes no app handle,
//! so a headless process reaches it directly.

use std::path::Path;

use serde_json::Value;

use super::store::{forget, lock, with_vault, VaultStore};
use super::Vault;
use crate::grants::GrantRegistry;

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("Failed to serialize index: {e}"))
}

#[tauri::command]
pub fn vault_snapshot(
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Value, String> {
    with_vault(&path, &grants, &store, |vault| to_value(vault.snapshot()))
}

/// Rebuild the index for `path` from disk, discarding what is cached for it.
#[tauri::command]
pub fn vault_refresh(
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Value, String> {
    let key = grants.ensure_workspace(&path)?;
    // A refresh is the frontend saying it wants the disk's answer, so unlike
    // `with_vault` this one replaces whatever is cached, including an index
    // that took watcher updates while the walk ran.
    let vault = Vault::build(Path::new(&path))?;
    let mut vaults = lock(&store)?;
    vaults.insert(key.clone(), vault);
    to_value(vaults[&key].snapshot())
}

#[tauri::command]
pub fn vault_forget(path: String, store: tauri::State<'_, VaultStore>) -> Result<(), String> {
    forget(&store, &path);
    Ok(())
}

#[tauri::command]
pub fn vault_backlinks(
    root: String,
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Value, String> {
    with_vault(&root, &grants, &store, |vault| {
        to_value(vault.backlinks(&path))
    })
}

#[tauri::command]
pub fn vault_resolve(
    root: String,
    from: Option<String>,
    targets: Vec<String>,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<Option<String>>, String> {
    with_vault(&root, &grants, &store, |vault| {
        Ok(vault
            .resolve_many(from.as_deref(), &targets)
            .into_iter()
            .map(|path| path.map(str::to_string))
            .collect())
    })
}

#[tauri::command]
pub fn vault_query(
    root: String,
    query: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Value, String> {
    with_vault(&root, &grants, &store, |vault| {
        to_value(vault.query(&query))
    })
}

#[tauri::command]
pub fn vault_paths_with_tag(
    root: String,
    tag: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<String>, String> {
    with_vault(&root, &grants, &store, |vault| {
        Ok(vault
            .paths_with_tag(&tag)
            .into_iter()
            .map(str::to_string)
            .collect())
    })
}
