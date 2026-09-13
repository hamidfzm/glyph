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
    let candidates = [dirs::data_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
        .chain(default_dirs());
    let mut found: Vec<PathBuf> = Vec::new();
    for dir in candidates.map(|dir| dir.join(identifier)) {
        if !found.contains(&dir) {
            found.push(dir);
        }
    }
    found
}

/// Where the directories are when no XDG variable moves them. An MCP client
/// may start the server with other variables than the app was started with.
#[cfg(target_os = "linux")]
fn default_dirs() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| vec![home.join(".local/share"), home.join(".config")])
        .unwrap_or_default()
}

#[cfg(not(target_os = "linux"))]
fn default_dirs() -> Vec<PathBuf> {
    Vec::new()
}

/// The first readable copy of the store file `name`.
pub fn read_store(name: &str) -> Option<String> {
    store_dirs().iter().find_map(|dir| read_store_in(dir, name))
}

pub fn read_store_in(dir: &Path, name: &str) -> Option<String> {
    std::fs::read_to_string(dir.join(name)).ok()
}

/// Held for the life of an interactive launch, so another process can tell
/// that the app is running. The OS releases it when the process ends, a crash
/// included, so it can never go stale.
pub struct InstanceLock {
    _file: File,
}

/// The app data directory, where the instance lock lives.
pub fn app_dir() -> Option<PathBuf> {
    store_dirs().into_iter().next()
}

pub fn hold_instance_lock(dir: &Path) -> Option<InstanceLock> {
    let file = std::fs::create_dir_all(dir)
        .and_then(|()| {
            OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(dir.join(INSTANCE_LOCK))
        })
        .map_err(|err| eprintln!("glyph: cannot open {INSTANCE_LOCK}: {err}"))
        .ok()?;
    acquire(|| file.try_lock())?;
    Some(InstanceLock { _file: file })
}

/// The lock once a probe in flight has let go; `None` for another window, or
/// for a filesystem that cannot lock at all.
fn acquire(mut try_lock: impl FnMut() -> Result<(), TryLockError>) -> Option<()> {
    // A `glyph mcp` probe holds a shared lock for an instant, so only a lock
    // still taken after a few tries belongs to another window.
    for _ in 0..5 {
        match try_lock() {
            Ok(()) => return Some(()),
            Err(TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(TryLockError::Error(err)) => {
                eprintln!(
                    "glyph: cannot lock {INSTANCE_LOCK}, so `glyph mcp` will see the app as closed: {err}"
                );
                return None;
            }
        }
    }
    None
}

/// Whether an interactive Glyph is running on this machine.
pub fn app_running() -> bool {
    app_dir().is_some_and(|dir| running_in(&dir))
}

pub(crate) fn running_in(dir: &Path) -> bool {
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

        let held = hold_instance_lock(dir.path()).expect("the first launch takes the lock");
        assert!(running_in(dir.path()));
        // A second window does not get it, and does not need it.
        assert!(hold_instance_lock(dir.path()).is_none());

        drop(held);
        assert!(
            !running_in(dir.path()),
            "the lock file stays, the lock does not"
        );
    }

    #[test]
    fn a_filesystem_that_cannot_lock_is_not_retried() {
        let started = std::time::Instant::now();
        let unsupported = || Err(TryLockError::Error(std::io::ErrorKind::Unsupported.into()));
        assert!(acquire(unsupported).is_none());
        assert!(started.elapsed() < std::time::Duration::from_millis(20));

        let mut probes = 2;
        let held_briefly = || {
            probes -= 1;
            if probes > 0 {
                Err(TryLockError::WouldBlock)
            } else {
                Ok(())
            }
        };
        assert!(acquire(held_briefly).is_some());
    }

    #[test]
    fn a_probe_in_flight_does_not_cost_the_app_its_lock() {
        let dir = tempfile::TempDir::new().unwrap();
        let probe = File::create(dir.path().join(INSTANCE_LOCK)).unwrap();
        probe.try_lock_shared().unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(30));
            drop(probe);
        });
        assert!(
            hold_instance_lock(dir.path()).is_some(),
            "the app waits the probe out"
        );
        release.join().unwrap();
    }
}
