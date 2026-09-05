//! The Tauri surface over [`Vault`]. Every command checks the grant registry
//! before the core touches the filesystem; the core itself takes no app handle,
//! so a headless process reaches it directly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use super::Vault;
use crate::grants::GrantRegistry;

/// One index per open workspace root, keyed by the root's canonical path. The
/// key cannot be the caller's spelling: `<ws>`, `<ws>/`, and `<ws>/./.` are one
/// workspace, and a renderer that cached an index under each would grow this
/// map without bound. `Vault.root` keeps the caller's spelling instead, so
/// indexed paths still match the frontend's tab paths.
#[derive(Default)]
pub struct VaultStore(pub Mutex<HashMap<PathBuf, Vault>>);

fn lock(store: &VaultStore) -> Result<std::sync::MutexGuard<'_, HashMap<PathBuf, Vault>>, String> {
    store.0.lock().map_err(|e| format!("Lock error: {e}"))
}

/// The store key for a root that has not been through a grant check.
fn key_for(root: &str) -> PathBuf {
    let path = Path::new(root);
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Run `read` against the index for `root`, building it first if this is the
/// first call for that root.
fn with_vault<T>(
    root: &str,
    grants: &GrantRegistry,
    store: &VaultStore,
    read: impl FnOnce(&Vault) -> Result<T, String>,
) -> Result<T, String> {
    // `ensure_workspace`, not `ensure_readable`: the index is per workspace,
    // and a readable check would also accept every directory inside one.
    let key = grants.ensure_workspace(root)?;
    if !lock(store)?.contains_key(&key) {
        // Built outside the lock: the walk reads the whole workspace, and
        // holding the store through it would stall every other root's queries
        // and block the watcher thread behind them. A build that loses the race
        // is discarded rather than replacing an index that has since taken
        // watcher updates.
        let vault = Vault::build(Path::new(root))?;
        lock(store)?.entry(key.clone()).or_insert(vault);
    }
    read(lock(store)?.get(&key).ok_or("index was released")?)
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("Failed to serialize index: {e}"))
}

/// Re-index the changed paths under `root`. Called from the directory watcher
/// before it tells the frontend to refresh, so the snapshot the frontend then
/// asks for is already current.
///
/// The store lock is held across the re-read and the rebuild. That is the
/// opposite trade to the initial build, and deliberate: an update touches the
/// paths that changed rather than the whole workspace, and letting a snapshot
/// interleave with it would serve a half-applied index.
pub fn apply_changes(store: &VaultStore, root: &str, paths: &[PathBuf]) {
    let Ok(mut vaults) = store.0.lock() else {
        return;
    };
    if let Some(vault) = vaults.get_mut(&key_for(root)) {
        vault.apply_changes(paths);
    }
}

/// Drop the index for a closing workspace. Nothing else releases it, and it
/// holds every note's tags, fields and links for the rest of the session.
pub fn forget(store: &VaultStore, root: &str) {
    if let Ok(mut vaults) = store.0.lock() {
        vaults.remove(&key_for(root));
    }
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
pub fn vault_neighbors(
    root: String,
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<String>, String> {
    with_vault(&root, &grants, &store, |vault| {
        Ok(vault
            .neighbors(&path)
            .into_iter()
            .map(str::to_string)
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

#[tauri::command]
pub fn vault_canvas(
    root: String,
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Option<Value>, String> {
    with_vault(&root, &grants, &store, |vault| {
        vault.canvas(&path).map(to_value).transpose()
    })
}
