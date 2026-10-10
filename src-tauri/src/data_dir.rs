//! Where the app keeps its persisted stores, found without Tauri's path
//! resolver so `glyph mcp` can read them from a process that never builds the
//! app. Tauri's `app_data_dir` and `app_config_dir` are these same `dirs`
//! lookups joined with the bundle identifier, and the store plugin resolves
//! its files against the first.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// `identifier` in `tauri.conf.json`, emitted by `build.rs`.
pub const IDENTIFIER: &str = env!("GLYPH_IDENTIFIER");

const INSTANCE_LOCK: &str = "instance.lock";

/// What the running app has open, rewritten as that changes, so `glyph mcp`
/// keeps off a note someone is editing. Only the holder of the instance lock
/// writes it, and it means nothing while that lock is free.
pub const OPEN_DOCUMENTS: &str = "open-documents.json";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OpenDocuments {
    /// Every file open in a tab of any window.
    pub open: Vec<String>,
    /// Those among them holding edits not yet saved.
    pub unsaved: Vec<String>,
}

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
    dir: PathBuf,
}

impl InstanceLock {
    /// Replace the published list. Written in place: a reader that catches it
    /// half written cannot parse it, and treats that as not knowing.
    pub fn publish(&self, documents: &OpenDocuments) {
        let written = serde_json::to_vec(documents)
            .map_err(std::io::Error::from)
            .and_then(|json| std::fs::write(self.dir.join(OPEN_DOCUMENTS), json));
        if let Err(err) = written {
            eprintln!("glyph: cannot write {OPEN_DOCUMENTS}: {err}");
        }
    }
}

/// The app data directory, where the instance lock lives.
pub fn app_dir() -> Option<PathBuf> {
    store_dirs().into_iter().next()
}

pub fn hold_instance_lock(dir: &Path) -> Option<InstanceLock> {
    hold_with_pause(dir, || {
        std::thread::sleep(std::time::Duration::from_millis(20));
    })
}

/// [`hold_instance_lock`] with the wait between tries handed in, so a test can
/// let a probe go at exactly that point instead of racing a timer for it.
fn hold_with_pause(dir: &Path, pause: impl FnMut()) -> Option<InstanceLock> {
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
    acquire(|| file.try_lock(), pause)?;
    let lock = InstanceLock {
        _file: file,
        dir: dir.to_path_buf(),
    };
    // Whatever an earlier run left behind describes windows that are gone.
    lock.publish(&OpenDocuments::default());
    Some(lock)
}

/// The lock once a probe in flight has let go; `None` for another window, or
/// for a filesystem that cannot lock at all.
fn acquire(
    mut try_lock: impl FnMut() -> Result<(), TryLockError>,
    mut pause: impl FnMut(),
) -> Option<()> {
    // A `glyph mcp` probe holds a shared lock for an instant, so only a lock
    // still taken after a few tries belongs to another window.
    for _ in 0..5 {
        match try_lock() {
            Ok(()) => return Some(()),
            Err(TryLockError::WouldBlock) => pause(),
            Err(TryLockError::Error(err)) => {
                eprintln!(
                    "glyph: cannot lock {INSTANCE_LOCK}, so `glyph mcp` cannot tell whether the app is running and will not change notes: {err}"
                );
                return None;
            }
        }
    }
    None
}

/// Whether an interactive Glyph is running on this machine. Every store
/// directory is asked, as the settings are looked for in each: a server
/// started with other XDG variables than the app still has to find its lock.
pub fn app_running() -> bool {
    store_dirs().iter().any(|dir| running_in(dir))
}

pub(crate) fn running_in(dir: &Path) -> bool {
    matches!(lock_in(dir), Lock::Held)
}

enum Lock {
    Free,
    Held,
    /// The lock could not be asked, so an app may hold it.
    Unknown,
}

fn lock_in(dir: &Path) -> Lock {
    match File::open(dir.join(INSTANCE_LOCK)) {
        Ok(file) => lock_state(file.try_lock_shared()),
        // No app has run from here.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Lock::Free,
        Err(_) => Lock::Unknown,
    }
}

fn lock_state(probe: Result<(), TryLockError>) -> Lock {
    match probe {
        Ok(()) => Lock::Free,
        Err(TryLockError::WouldBlock) => Lock::Held,
        Err(TryLockError::Error(_)) => Lock::Unknown,
    }
}

/// What a running app's windows hold, for a caller about to change a note.
#[derive(Debug, PartialEq)]
pub enum Editing {
    /// No app is running, so nothing is open.
    Closed,
    Open(OpenDocuments),
    /// An app is running, or may be, and has not said what it holds: its list
    /// is missing or unreadable, or its lock cannot be asked.
    Unknown,
}

/// What the app running on this machine holds. `stores` is where it keeps its
/// lock; `None` asks every store directory.
pub fn editing(stores: Option<&Path>) -> Editing {
    let dirs = stores.map_or_else(store_dirs, |dir| vec![dir.to_path_buf()]);
    combined(dirs.iter().map(|dir| editing_in(dir)))
}

fn editing_in(dir: &Path) -> Editing {
    match lock_in(dir) {
        Lock::Free => Editing::Closed,
        Lock::Unknown => Editing::Unknown,
        Lock::Held => read_store_in(dir, OPEN_DOCUMENTS)
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .map_or(Editing::Unknown, Editing::Open),
    }
}

/// One answer from several directories: not knowing about any of them is not
/// knowing, and two apps running from two of them both count.
fn combined(states: impl Iterator<Item = Editing>) -> Editing {
    let mut running: Option<OpenDocuments> = None;
    for state in states {
        match state {
            Editing::Unknown => return Editing::Unknown,
            Editing::Closed => {}
            Editing::Open(found) => {
                let all = running.get_or_insert_with(OpenDocuments::default);
                all.open.extend(found.open);
                all.unsaved.extend(found.unsaved);
            }
        }
    }
    running.map_or(Editing::Closed, Editing::Open)
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
        let asked = std::time::Instant::now();
        assert!(hold_instance_lock(dir.path()).is_none());
        // It waited between its tries, which is what lets a probe go.
        assert!(asked.elapsed() >= std::time::Duration::from_millis(60));

        release(held, dir.path());
        assert!(
            !running_in(dir.path()),
            "the lock file stays, the lock does not"
        );
    }

    /// Drop the lock and wait out any copy of it. On Unix the lock belongs to
    /// the open file, which a child process another test starts shares until
    /// it execs or exits.
    fn release(held: InstanceLock, dir: &Path) {
        drop(held);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while running_in(dir) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    #[test]
    fn a_copy_of_a_released_lock_is_waited_out() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let held = hold_instance_lock(dir.path()).unwrap();
        // A second handle on the same open file, which is what a child holds.
        let copy = held._file.try_clone().unwrap();
        let let_go = Arc::new(AtomicBool::new(false));
        let child = std::thread::spawn({
            let let_go = Arc::clone(&let_go);
            move || {
                std::thread::sleep(std::time::Duration::from_millis(50));
                let_go.store(true, Ordering::SeqCst);
                drop(copy);
            }
        });

        release(held, dir.path());
        assert!(
            let_go.load(Ordering::SeqCst),
            "release came back while the copy still held the lock"
        );
        assert!(!running_in(dir.path()));
        child.join().unwrap();
    }

    fn documents(open: &[&str], unsaved: &[&str]) -> OpenDocuments {
        let paths = |paths: &[&str]| paths.iter().map(|path| path.to_string()).collect();
        OpenDocuments {
            open: paths(open),
            unsaved: paths(unsaved),
        }
    }

    #[test]
    fn what_is_being_edited_is_read_only_from_the_app_holding_the_lock() {
        let dir = tempfile::TempDir::new().unwrap();
        // No app has run here; and a list an earlier run left says nothing.
        assert_eq!(editing_in(dir.path()), Editing::Closed);
        let stale = r#"{"open":["/gone.md"],"unsaved":["/gone.md"]}"#;
        std::fs::write(dir.path().join(OPEN_DOCUMENTS), stale).unwrap();

        // Taking the lock clears it.
        let held = hold_instance_lock(dir.path()).unwrap();
        assert_eq!(
            editing_in(dir.path()),
            Editing::Open(OpenDocuments::default())
        );
        let now = documents(&["/a.md", "/b.md"], &["/b.md"]);
        held.publish(&now);
        assert_eq!(editing_in(dir.path()), Editing::Open(now));

        // A list the reader cannot make sense of is not an empty one.
        for garbled in ["{", r#"{"open":"all"}"#, "[]"] {
            std::fs::write(dir.path().join(OPEN_DOCUMENTS), garbled).unwrap();
            assert_eq!(editing_in(dir.path()), Editing::Unknown, "{garbled}");
        }
        release(held, dir.path());
        assert_eq!(editing_in(dir.path()), Editing::Closed);
    }

    #[test]
    fn a_list_that_cannot_be_written_does_not_cost_the_app_its_lock() {
        let dir = tempfile::TempDir::new().unwrap();
        // A folder sits where the list goes, so every write to it fails.
        std::fs::create_dir(dir.path().join(OPEN_DOCUMENTS)).unwrap();

        let held = hold_instance_lock(dir.path());
        assert!(held.is_some() && running_in(dir.path()));
        // Nothing readable is there, which a reader takes as not knowing.
        assert_eq!(editing_in(dir.path()), Editing::Unknown);
    }

    #[test]
    fn a_lock_that_cannot_be_opened_is_not_taken_for_no_app() {
        // No file name holds a NUL, so opening the lock fails for a reason
        // other than its absence.
        let unaskable = Path::new("stores\0");
        assert_eq!(editing(Some(unaskable)), Editing::Unknown);
    }

    #[test]
    fn not_knowing_whether_an_app_runs_is_not_a_closed_app() {
        // A filesystem that cannot lock leaves the lock unasked.
        let unsupported = Err(TryLockError::Error(std::io::ErrorKind::Unsupported.into()));
        assert!(matches!(lock_state(unsupported), Lock::Unknown));
        assert!(matches!(lock_state(Ok(())), Lock::Free));
        assert!(matches!(
            lock_state(Err(TryLockError::WouldBlock)),
            Lock::Held
        ));

        // One directory not knowing outweighs the others, in any order.
        let open = || Editing::Open(documents(&["/a.md"], &[]));
        let other = || Editing::Open(documents(&["/b.md"], &[]));
        assert_eq!(combined([].into_iter()), Editing::Closed);
        assert_eq!(combined([Editing::Closed, open()].into_iter()), open());
        // Two apps, each under its own directory: both lists count.
        assert_eq!(
            combined([open(), Editing::Closed, other()].into_iter()),
            Editing::Open(documents(&["/a.md", "/b.md"], &[]))
        );
        assert_eq!(
            combined([open(), Editing::Closed, Editing::Unknown].into_iter()),
            Editing::Unknown
        );
        assert_eq!(
            combined([Editing::Unknown, open()].into_iter()),
            Editing::Unknown
        );
    }

    #[test]
    fn a_filesystem_that_cannot_lock_is_not_retried() {
        let mut tries = 0;
        let mut pauses = 0;
        let unsupported = || {
            tries += 1;
            Err(TryLockError::Error(std::io::ErrorKind::Unsupported.into()))
        };
        assert!(acquire(unsupported, || pauses += 1).is_none());
        assert_eq!(tries, 1);
        assert_eq!(pauses, 0, "it gives up without waiting");

        let mut probes = 2;
        let held_briefly = || {
            probes -= 1;
            if probes > 0 {
                Err(TryLockError::WouldBlock)
            } else {
                Ok(())
            }
        };
        assert!(acquire(held_briefly, || {}).is_some());

        let mut tries = 0;
        let another_window = || {
            tries += 1;
            Err(TryLockError::WouldBlock)
        };
        assert!(acquire(another_window, || {}).is_none());
        assert_eq!(tries, 5);
    }

    #[test]
    fn a_probe_in_flight_does_not_cost_the_app_its_lock() {
        let dir = tempfile::TempDir::new().unwrap();
        let probe = File::create(dir.path().join(INSTANCE_LOCK)).unwrap();
        probe.try_lock_shared().unwrap();
        let mut pauses = 0;
        // The probe lets go while the app waits. Unlocked rather than closed:
        // a closed file keeps its lock for as long as a child holds a copy.
        let held = hold_with_pause(dir.path(), || {
            pauses += 1;
            let _ = probe.unlock();
        });
        assert!(held.is_some(), "the app waits the probe out");
        assert_eq!(pauses, 1, "it found the probe there once");
    }
}
