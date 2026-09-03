//! The rebuild trigger behind `glyph serve`.
//!
//! Separate from [`crate::watcher`], which serves the running app's open tabs
//! and workspaces: this one watches a folder nobody has open, and its answer
//! is not "refresh a view" but "render the whole site again".

use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

/// Event the frontend listens on to know it should export again.
pub const CHANGED_EVENT: &str = "serve://changed";

/// How long to keep collecting changes before rebuilding. Saving a file
/// commonly produces several events, and an editor writing a whole directory
/// produces a burst of them; rebuilding per event would mean rendering the
/// site several times to reach the same place.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// Whether a filesystem change should rebuild the site.
///
/// Unlike the app's own directory watch this does not filter down to markdown:
/// an image, a stylesheet, or the site configuration all change what the
/// export produces.
///
/// What it does filter out is hidden paths, which the export's own walker
/// skips, so a `.git` write during a commit would otherwise rebuild a site
/// whose content cannot have changed. The workspace configuration folder is
/// the exception: `.glyph/site.json` is hidden but the export reads it, so
/// editing the site title has to rebuild like any other change.
///
/// Hidden-ness is judged relative to `root`, exactly as the export's walker
/// judges it by depth. Serving a folder that lives under a hidden one is
/// ordinary (`~/.config/notes`, a dotfiles repo), and testing the absolute
/// path would classify every event inside it as hidden and quietly stop
/// rebuilding for the life of the process.
pub fn is_relevant_change(event: &Event, root: &Path) -> bool {
    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    ) {
        return false;
    }
    event.paths.iter().any(|path| !is_ignored(path, root))
}

/// The workspace configuration folder, which is hidden but is read by the
/// export. Kept in step with `SITE_CONFIG_PATH` on the frontend.
const CONFIG_DIR: &str = ".glyph";

/// Whether a path lives somewhere the export does not read: any hidden
/// directory or file below `root`, except the workspace configuration folder.
fn is_ignored(path: &Path, root: &Path) -> bool {
    // Anything at or above the root is the user's choice of folder, not
    // content, so only the part below it is classified.
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.components().any(|component| {
        component.as_os_str().to_str().is_some_and(|name| {
            name.starts_with('.') && name != "." && name != ".." && name != CONFIG_DIR
        })
    })
}

/// Watch `root` and emit [`CHANGED_EVENT`] whenever its contents change,
/// coalescing bursts. The returned watcher must be kept alive: dropping it
/// stops the watch.
pub fn watch<R: Runtime>(app: AppHandle<R>, root: &Path) -> notify::Result<RecommendedWatcher> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = sender.send(result);
    })?;
    watcher.watch(root, RecursiveMode::Recursive)?;

    let root = root.to_path_buf();
    std::thread::spawn(move || debounce_loop(&app, &receiver, &root));
    Ok(watcher)
}

/// Block on changes, collapse each burst into one rebuild, and tell the
/// frontend. Ends when the watcher is dropped and the channel closes.
fn debounce_loop<R: Runtime>(
    app: &AppHandle<R>,
    receiver: &Receiver<Result<Event, notify::Error>>,
    root: &Path,
) {
    while let Ok(first) = receiver.recv() {
        if !first.is_ok_and(|event| is_relevant_change(&event, root)) {
            continue;
        }
        drain_burst(receiver);
        let _ = app.emit(CHANGED_EVENT, root.to_string_lossy().to_string());
    }
}

/// Swallow everything that arrives within the debounce window, so a burst of
/// saves produces one rebuild instead of one per event.
fn drain_burst(receiver: &Receiver<Result<Event, notify::Error>>) {
    let deadline = Instant::now() + DEBOUNCE;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match receiver.recv_timeout(remaining) {
            Ok(_) => continue,
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    use std::path::PathBuf;

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        Event {
            kind,
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: Default::default(),
        }
    }

    #[test]
    fn content_changes_rebuild_whatever_the_file_type() {
        let root = Path::new("/ws");
        // Not just markdown: images and stylesheets change the output too.
        for path in ["/ws/notes.md", "/ws/assets/diagram.png", "/ws/style.css"] {
            assert!(
                is_relevant_change(&event(EventKind::Modify(ModifyKind::Any), &[path]), root),
                "{path} should rebuild"
            );
        }
        assert!(is_relevant_change(
            &event(EventKind::Create(CreateKind::File), &["/ws/new.md"]),
            root
        ));
        assert!(is_relevant_change(
            &event(EventKind::Remove(RemoveKind::File), &["/ws/gone.md"]),
            root
        ));
    }

    #[test]
    fn hidden_paths_do_not_rebuild() {
        let root = Path::new("/ws");
        // A commit writes constantly inside .git, and none of it can change
        // what the export produces, because the walker skips hidden paths.
        for path in [
            "/ws/.git/index",
            "/ws/.git/objects/ab/cdef",
            "/ws/.DS_Store",
        ] {
            assert!(
                !is_relevant_change(&event(EventKind::Modify(ModifyKind::Any), &[path]), root),
                "{path} should be ignored"
            );
        }
    }

    #[test]
    fn the_workspace_configuration_folder_still_rebuilds() {
        let root = Path::new("/ws");
        // .glyph is hidden but the export reads site.json out of it, so
        // renaming the site has to reach the served pages.
        assert!(is_relevant_change(
            &event(
                EventKind::Modify(ModifyKind::Any),
                &["/ws/.glyph/site.json"]
            ),
            root
        ));
    }

    #[test]
    fn a_workspace_inside_a_hidden_folder_still_rebuilds() {
        // Serving `~/.config/notes` or a dotfiles repo is ordinary. Judging
        // the absolute path would call every event inside it hidden and stop
        // rebuilding for the life of the process, with nothing said.
        for (root, changed) in [
            ("/home/me/.config/notes", "/home/me/.config/notes/index.md"),
            ("/home/me/.dotfiles/docs", "/home/me/.dotfiles/docs/a/b.md"),
        ] {
            assert!(
                is_relevant_change(
                    &event(EventKind::Modify(ModifyKind::Any), &[changed]),
                    Path::new(root)
                ),
                "{changed} should rebuild when serving {root}"
            );
        }

        // Hidden folders *below* the root are still ignored.
        assert!(!is_relevant_change(
            &event(
                EventKind::Modify(ModifyKind::Any),
                &["/home/me/.config/notes/.git/index"]
            ),
            Path::new("/home/me/.config/notes")
        ));
    }

    #[test]
    fn a_burst_touching_one_visible_file_still_rebuilds() {
        let root = Path::new("/ws");
        let mixed = event(
            EventKind::Modify(ModifyKind::Any),
            &["/ws/.git/index", "/ws/notes.md"],
        );
        assert!(is_relevant_change(&mixed, root));
    }

    #[test]
    fn access_only_events_do_not_rebuild() {
        let root = Path::new("/ws");
        let accessed = event(
            EventKind::Access(notify::event::AccessKind::Read),
            &["/ws/notes.md"],
        );
        assert!(!is_relevant_change(&accessed, root));
    }

    #[test]
    fn a_real_edit_reaches_the_frontend_as_one_rebuild() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        use tauri::Listener;

        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("index.md"), "# Home").unwrap();

        let app = tauri::test::mock_app();
        let rebuilds = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&rebuilds);
        app.listen(CHANGED_EVENT, move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
        });

        // Held for the length of the test: dropping it stops the watch.
        let _watcher = watch(app.handle().clone(), dir.path()).expect("watches");
        // The watch is registered asynchronously by the OS, so an edit made
        // immediately can be missed.
        std::thread::sleep(Duration::from_millis(300));

        // A burst, the way an editor saves: several writes in quick
        // succession that should amount to one rebuild.
        for i in 0..3 {
            std::fs::write(dir.path().join("index.md"), format!("# Home {i}")).unwrap();
            std::thread::sleep(Duration::from_millis(30));
        }

        // Long enough for the debounce window to close and the event to land.
        std::thread::sleep(DEBOUNCE + Duration::from_millis(700));
        let seen = rebuilds.load(Ordering::SeqCst);
        assert!(seen >= 1, "an edit should rebuild, saw {seen}");
        assert!(seen <= 2, "a burst should coalesce, saw {seen} rebuilds");

        // Now the noise a real workspace generates: a commit writes inside
        // .git constantly, and none of it can change what the export reads.
        std::fs::create_dir_all(dir.path().join(".git/objects")).unwrap();
        for i in 0..3 {
            std::fs::write(dir.path().join(format!(".git/objects/{i}")), "x").unwrap();
            std::thread::sleep(Duration::from_millis(30));
        }
        std::thread::sleep(DEBOUNCE + Duration::from_millis(700));
        assert_eq!(
            rebuilds.load(Ordering::SeqCst),
            seen,
            "writes under .git must not rebuild the site"
        );
    }

    #[test]
    fn watching_a_folder_that_is_not_there_is_an_error_not_a_panic() {
        let app = tauri::test::mock_app();
        let missing = std::env::temp_dir().join("glyph-serve-no-such-folder");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(watch(app.handle().clone(), &missing).is_err());
    }

    #[test]
    fn drain_burst_returns_once_the_channel_closes() {
        let (sender, receiver) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
        drop(sender);
        let started = Instant::now();
        drain_burst(&receiver);
        assert!(
            started.elapsed() < DEBOUNCE,
            "a closed channel should not wait out the window"
        );
    }

    #[test]
    fn drain_burst_waits_out_the_window_when_events_keep_arriving() {
        let (sender, receiver) = std::sync::mpsc::channel();
        // The original sender stays in this scope: dropping every sender is
        // what the disconnect case above covers, and it would end the window
        // early here for the wrong reason.
        let ticker = sender.clone();
        std::thread::spawn(move || {
            for _ in 0..3 {
                let _ = ticker.send(Ok(event(
                    EventKind::Modify(ModifyKind::Any),
                    &["/ws/notes.md"],
                )));
                std::thread::sleep(Duration::from_millis(40));
            }
        });

        let started = Instant::now();
        drain_burst(&receiver);
        assert!(
            started.elapsed() >= DEBOUNCE,
            "a burst should be collapsed into one window, not cut short"
        );
        drop(sender);
    }
}
