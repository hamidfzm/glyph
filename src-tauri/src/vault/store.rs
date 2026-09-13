//! One index per open workspace, shared by the Tauri commands, the directory
//! watcher, and `glyph mcp`. Nothing here holds an app handle, so a headless
//! process uses the same gate and cache the app does.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use super::Vault;
use crate::grants::GrantRegistry;

/// One index per open workspace root, keyed by the root's canonical path. The
/// key cannot be the caller's spelling: `<ws>`, `<ws>/`, and `<ws>/./.` are one
/// workspace, and a renderer that cached an index under each would grow this
/// map without bound. `Vault.root` keeps the caller's spelling instead, so
/// indexed paths still match the frontend's tab paths.
#[derive(Default)]
pub struct VaultStore(pub Mutex<HashMap<PathBuf, Vault>>);

type Vaults<'a> = MutexGuard<'a, HashMap<PathBuf, Vault>>;

pub(super) fn lock(store: &VaultStore) -> Result<Vaults<'_>, String> {
    Ok(store.0.lock().unwrap_or_else(|poisoned| {
        // A panic mid-update leaves an index half applied; every root is
        // rebuilt from disk on its next call.
        store.0.clear_poison();
        let mut vaults = poisoned.into_inner();
        vaults.clear();
        vaults
    }))
}

/// The store key for a root that has not been through a grant check.
fn key_for(root: &str) -> PathBuf {
    let path = Path::new(root);
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// The store, locked, with an index for `key` in it.
fn built<'a>(root: &str, key: &Path, store: &'a VaultStore) -> Result<Vaults<'a>, String> {
    if !lock(store)?.contains_key(key) {
        // Built outside the lock: the walk reads the whole workspace, and
        // holding the store through it would stall every other root's queries
        // and block the watcher thread behind them. A build that loses the race
        // is discarded rather than replacing an index that has since taken
        // watcher updates.
        let vault = Vault::build(Path::new(root))?;
        lock(store)?.entry(key.to_path_buf()).or_insert(vault);
    }
    lock(store)
}

/// Run `read` against the index for `root`, building it first if this is the
/// first call for that root.
pub(crate) fn with_vault<T>(
    root: &str,
    grants: &GrantRegistry,
    store: &VaultStore,
    read: impl FnOnce(&Vault) -> Result<T, String>,
) -> Result<T, String> {
    // `ensure_workspace`, not `ensure_readable`: the index is per workspace,
    // and a readable check would also accept every directory inside one.
    let key = grants.ensure_workspace(root)?;
    let vaults = built(root, &key, store)?;
    read(vaults.get(&key).ok_or("index was released")?)
}

/// [`with_vault`] for a caller no watcher keeps current: the index catches up
/// with the disk first, so a change made since the last call is in the answer.
pub(crate) fn with_synced_vault<T>(
    root: &str,
    grants: &GrantRegistry,
    store: &VaultStore,
    read: impl FnOnce(&Vault) -> Result<T, String>,
) -> Result<T, String> {
    let key = grants.ensure_workspace(root)?;
    let mut vaults = built(root, &key, store)?;
    let vault = vaults.get_mut(&key).ok_or("index was released")?;
    vault.sync()?;
    read(vault)
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
