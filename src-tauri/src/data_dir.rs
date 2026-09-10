//! Where the app keeps its persisted stores, found without Tauri's path
//! resolver so `glyph mcp` can read them from a process that never builds the
//! app. Tauri's `app_data_dir` and `app_config_dir` are these same `dirs`
//! lookups joined with the bundle identifier, and the store plugin resolves
//! its files against the first.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

/// `identifier` in `tauri.conf.json`, emitted by `build.rs`.
pub const IDENTIFIER: &str = env!("GLYPH_IDENTIFIER");

const INSTANCE_LOCK: &str = "instance.lock";

/// The app data directory, then the config directory where that differs
/// (Linux), which is where an older layout may have left the settings.
fn store_dirs() -> Vec<PathBuf> {
    dirs_for(IDENTIFIER)
}

fn dirs_for(identifier: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = [dirs::data_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
        .map(|dir| dir.join(identifier))
        .collect();
    found.dedup();
    found
}

/// The first readable copy of the store file `name`.
pub fn read_store(name: &str) -> Option<String> {
    store_dirs()
        .iter()
        .find_map(|dir| std::fs::read_to_string(dir.join(name)).ok())
}

/// Held for the life of an interactive launch, so another process can tell
/// that the app is running. The OS releases it when the process ends, a crash
/// included, so it can never go stale.
pub struct InstanceLock {
    _file: File,
}

pub fn hold_instance_lock() -> Option<InstanceLock> {
    lock_in(store_dirs().first()?)
}

fn lock_in(dir: &Path) -> Option<InstanceLock> {
    std::fs::create_dir_all(dir).ok()?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(INSTANCE_LOCK))
        .ok()?;
    // Another window of the app already holds it, which is all the lock says.
    file.try_lock().ok()?;
    Some(InstanceLock { _file: file })
}

/// Whether an interactive Glyph is running on this machine.
pub fn app_running() -> bool {
    store_dirs().first().is_some_and(|dir| running_in(dir))
}

fn running_in(dir: &Path) -> bool {
    let Ok(file) = File::open(dir.join(INSTANCE_LOCK)) else {
        return false;
    };
    matches!(file.try_lock_shared(), Err(TryLockError::WouldBlock))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    #[test]
    fn the_directories_are_the_ones_tauri_resolves() {
        let app = tauri::test::mock_app();
        let dirs = dirs_for(&app.config().identifier);
        assert_eq!(dirs[0], app.path().app_data_dir().unwrap());
        assert!(dirs.contains(&app.path().app_config_dir().unwrap()));
    }

    #[test]
    fn the_identifier_is_the_bundle_identifier() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn a_held_lock_reads_as_running_until_it_is_released() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(!running_in(dir.path()), "no lock file yet");

        let held = lock_in(dir.path()).expect("the first launch takes the lock");
        assert!(running_in(dir.path()));
        // A second window does not get it, and does not need it.
        assert!(lock_in(dir.path()).is_none());

        drop(held);
        assert!(
            !running_in(dir.path()),
            "the lock file stays, the lock does not"
        );
    }
}
