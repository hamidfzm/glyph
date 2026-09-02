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
pub fn is_relevant_change(event: &Event) -> bool {
    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    ) {
        return false;
    }
    event.paths.iter().any(|path| !is_ignored(path))
}

/// The workspace configuration folder, which is hidden but is read by the
/// export. Kept in step with `SITE_CONFIG_PATH` on the frontend.
const CONFIG_DIR: &str = ".glyph";

/// Whether a path lives somewhere the export does not read: any hidden
/// directory or file except the workspace configuration folder.
fn is_ignored(path: &Path) -> bool {
    path.components().any(|component| {
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
        if !first.is_ok_and(|event| is_relevant_change(&event)) {
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
        // Not just markdown: images and stylesheets change the output too.
        for path in ["/ws/notes.md", "/ws/assets/diagram.png", "/ws/style.css"] {
            assert!(
                is_relevant_change(&event(EventKind::Modify(ModifyKind::Any), &[path])),
                "{path} should rebuild"
            );
        }
        assert!(is_relevant_change(&event(
            EventKind::Create(CreateKind::File),
            &["/ws/new.md"]
        )));
        assert!(is_relevant_change(&event(
            EventKind::Remove(RemoveKind::File),
            &["/ws/gone.md"]
        )));
    }

    #[test]
    fn hidden_paths_do_not_rebuild() {
        // A commit writes constantly inside .git, and none of it can change
        // what the export produces, because the walker skips hidden paths.
        for path in [
            "/ws/.git/index",
            "/ws/.git/objects/ab/cdef",
            "/ws/.DS_Store",
        ] {
            assert!(
                !is_relevant_change(&event(EventKind::Modify(ModifyKind::Any), &[path])),
                "{path} should be ignored"
            );
        }
    }

    #[test]
    fn the_workspace_configuration_folder_still_rebuilds() {
        // .glyph is hidden but the export reads site.json out of it, so
        // renaming the site has to reach the served pages.
        assert!(is_relevant_change(&event(
            EventKind::Modify(ModifyKind::Any),
            &["/ws/.glyph/site.json"]
        )));
    }

    #[test]
    fn a_burst_touching_one_visible_file_still_rebuilds() {
        let mixed = event(
            EventKind::Modify(ModifyKind::Any),
            &["/ws/.git/index", "/ws/notes.md"],
        );
        assert!(is_relevant_change(&mixed));
    }

    #[test]
    fn access_only_events_do_not_rebuild() {
        let accessed = event(
            EventKind::Access(notify::event::AccessKind::Read),
            &["/ws/notes.md"],
        );
        assert!(!is_relevant_change(&accessed));
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
