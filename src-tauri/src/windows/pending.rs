//! Handing open requests to a window. An event carrying the path is lost
//! whenever the window is not listening (a cold start, the app's first
//! moments, a page reload), so the path waits in a queue per window and the
//! event is only a nudge: the frontend takes the whole queue when nudged, and
//! once on mount after attaching its listener. An open queued before a take
//! is returned by it and one queued after is nudged again, so each is handed
//! over exactly once and none is left to resurface.

use super::{OpenKind, PendingOpen, WindowRegistry};

impl WindowRegistry {
    /// Queue `open` for the window `label`, for the caller to nudge. Returns
    /// whether that window has mounted.
    ///
    /// Until it has, the window cannot report what it shows, so the open also
    /// claims its path for routing: a folder as the window's workspace, a file
    /// as one of its tabs. The window's first report replaces the claim.
    pub fn queue_open(&self, label: &str, open: PendingOpen) -> bool {
        let mut windows = self.inner.lock().unwrap();
        let mounted = windows.mounted.contains(label);
        if !mounted {
            match open.kind {
                OpenKind::Folder => {
                    windows
                        .workspaces
                        .insert(label.to_string(), Some(open.path.clone()));
                }
                OpenKind::File => {
                    let files = windows.files.entry(label.to_string()).or_default();
                    if !files.contains(&open.path) {
                        files.push(open.path.clone());
                    }
                }
            }
        }
        let queue = windows.pending.entry(label.to_string()).or_default();
        if !queue.contains(&open) {
            queue.push(open);
        }
        mounted
    }

    /// Take everything queued for the window `label`, in arrival order.
    pub fn take_pending(&self, label: &str) -> Vec<PendingOpen> {
        let mut windows = self.inner.lock().unwrap();
        windows.mounted.insert(label.to_string());
        windows.pending.remove(label).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::super::{route_open, OpenRoute, OpenTarget};
    use super::*;

    fn file(path: &str) -> PendingOpen {
        PendingOpen {
            kind: OpenKind::File,
            path: path.to_string(),
        }
    }

    fn folder(path: &str) -> PendingOpen {
        PendingOpen {
            kind: OpenKind::Folder,
            path: path.to_string(),
        }
    }

    #[test]
    fn a_second_open_before_mount_does_not_overwrite_the_first() {
        // Two forwarded launches in the app's first moments, or one launch
        // naming two files: a single slot kept only the last.
        let registry = WindowRegistry::new();
        registry.queue_open("main", file("/a.md"));
        registry.queue_open("main", file("/b.md"));

        assert_eq!(
            registry.take_pending("main"),
            vec![file("/a.md"), file("/b.md")]
        );
    }

    #[test]
    fn the_queue_is_handed_over_exactly_once() {
        let registry = WindowRegistry::new();
        registry.queue_open("main", file("/a.md"));

        assert_eq!(registry.take_pending("main"), vec![file("/a.md")]);
        // A reload asking again must not get an earlier launch's file back.
        assert!(registry.take_pending("main").is_empty());
    }

    #[test]
    fn an_open_for_a_mounted_window_waits_in_the_queue_too() {
        // The path never rides on the event: a window that is reloading when
        // it arrives finds it here once the new page takes its queue.
        let registry = WindowRegistry::new();
        assert!(!registry.queue_open("main", file("/a.md")));
        registry.take_pending("main");

        assert!(registry.queue_open("main", file("/b.md")));
        assert_eq!(registry.take_pending("main"), vec![file("/b.md")]);
    }

    #[test]
    fn the_same_open_queued_twice_is_handed_over_once() {
        let registry = WindowRegistry::new();
        registry.queue_open("main", file("/a.md"));
        registry.queue_open("main", file("/a.md"));

        assert_eq!(registry.take_pending("main"), vec![file("/a.md")]);
    }

    #[test]
    fn each_window_has_its_own_queue() {
        let registry = WindowRegistry::new();
        registry.queue_open("main", file("/a.md"));
        registry.queue_open("w1", file("/b.md"));

        assert_eq!(registry.take_pending("w1"), vec![file("/b.md")]);
        // `w1` mounting does not mount `main`.
        assert!(!registry.queue_open("main", file("/c.md")));
        assert_eq!(
            registry.take_pending("main"),
            vec![file("/a.md"), file("/c.md")]
        );
    }

    #[test]
    fn a_folder_queued_before_mount_claims_the_window_so_the_next_one_spawns() {
        let registry = WindowRegistry::new();
        registry.queue_open("main", folder("/ws"));

        let snapshot = registry.snapshot();
        assert_eq!(
            snapshot.workspaces,
            vec![("main".to_string(), Some("/ws".to_string()))]
        );
        assert_eq!(
            route_open(
                OpenKind::Folder,
                "/other",
                &snapshot,
                "main",
                OpenTarget::Current
            ),
            OpenRoute::NewWindow(folder("/other"))
        );
    }

    #[test]
    fn a_file_queued_before_mount_claims_its_path_so_no_other_window_opens_it() {
        // A window spawned in the same launch may restore this file from its
        // own session before `main` has mounted and reported it.
        let registry = WindowRegistry::new();
        registry.queue_open("main", file("/ws/note.md"));
        registry.queue_open("main", file("/ws/note.md"));

        let snapshot = registry.snapshot();
        assert_eq!(
            snapshot.files,
            vec![("main".to_string(), vec!["/ws/note.md".to_string()])]
        );
        assert_eq!(snapshot.window_with_file("/ws/note.md", "w1"), Some("main"));
    }

    #[test]
    fn an_open_for_a_mounted_window_claims_nothing() {
        // That window reports for itself once it has opened the path, and
        // reports nothing if it refuses it.
        let registry = WindowRegistry::new();
        registry.take_pending("main");

        registry.queue_open("main", folder("/ws"));
        registry.queue_open("main", file("/a.md"));

        assert_eq!(
            registry.snapshot(),
            super::super::WindowsSnapshot::default()
        );
    }

    #[test]
    fn a_closed_window_forgets_its_queue_and_that_it_had_mounted() {
        let registry = WindowRegistry::new();
        registry.queue_open("w1", file("/a.md"));
        registry.remove("w1");
        assert!(registry.take_pending("w1").is_empty());

        // That take mounted the label; closing clears it too.
        registry.remove("w1");
        assert!(!registry.queue_open("w1", file("/b.md")));
    }
}
