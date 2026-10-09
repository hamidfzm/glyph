//! Handing open requests to a window whose frontend may not be listening yet
//! (a cold start, a launch forwarded in the app's first moments, a macOS
//! `Opened` event at launch). An event emitted before the listeners exist is
//! lost, so a window's opens are queued until it takes the queue; from that
//! step on they are emitted. Nothing arrives twice or is left to resurface.

use super::{OpenKind, PendingOpen, WindowRegistry};

impl WindowRegistry {
    /// Hand `open` to the window `label`: returned when that window is
    /// listening, for the caller to emit, and queued otherwise.
    ///
    /// A queued folder also claims the window's workspace, which the window
    /// cannot report until it has mounted, so routing sends the next folder
    /// elsewhere.
    pub fn deliver(&self, label: &str, open: PendingOpen) -> Option<PendingOpen> {
        let mut windows = self.inner.lock().unwrap();
        if windows.listening.contains(label) {
            return Some(open);
        }
        if open.kind == OpenKind::Folder {
            windows
                .workspaces
                .insert(label.to_string(), Some(open.path.clone()));
        }
        let queue = windows.pending.entry(label.to_string()).or_default();
        if !queue.contains(&open) {
            queue.push(open);
        }
        None
    }

    /// The window `label` has attached its listeners: take everything queued
    /// for it, in arrival order, and deliver to it directly from here on.
    pub fn take_pending(&self, label: &str) -> Vec<PendingOpen> {
        let mut windows = self.inner.lock().unwrap();
        windows.listening.insert(label.to_string());
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
        // naming two files: the single stash slot kept only the last.
        let registry = WindowRegistry::new();
        assert_eq!(registry.deliver("main", file("/a.md")), None);
        assert_eq!(registry.deliver("main", file("/b.md")), None);

        assert_eq!(
            registry.take_pending("main"),
            vec![file("/a.md"), file("/b.md")]
        );
    }

    #[test]
    fn the_queue_is_handed_over_exactly_once() {
        let registry = WindowRegistry::new();
        registry.deliver("main", file("/a.md"));

        assert_eq!(registry.take_pending("main"), vec![file("/a.md")]);
        // A reload asking again must not get an earlier launch's file back.
        assert!(registry.take_pending("main").is_empty());
    }

    #[test]
    fn a_listening_window_gets_its_opens_directly_and_nothing_is_kept() {
        let registry = WindowRegistry::new();
        assert!(registry.take_pending("main").is_empty());

        assert_eq!(registry.deliver("main", file("/a.md")), Some(file("/a.md")));
        assert!(registry.take_pending("main").is_empty());
    }

    #[test]
    fn the_same_open_queued_twice_is_delivered_once() {
        let registry = WindowRegistry::new();
        registry.deliver("main", file("/a.md"));
        registry.deliver("main", file("/a.md"));

        assert_eq!(registry.take_pending("main"), vec![file("/a.md")]);
    }

    #[test]
    fn each_window_has_its_own_queue() {
        let registry = WindowRegistry::new();
        registry.deliver("main", file("/a.md"));
        registry.deliver("w1", file("/b.md"));

        assert_eq!(registry.take_pending("w1"), vec![file("/b.md")]);
        // `w1` listening does not make `main` listen.
        assert_eq!(registry.deliver("main", file("/c.md")), None);
        assert_eq!(
            registry.take_pending("main"),
            vec![file("/a.md"), file("/c.md")]
        );
    }

    #[test]
    fn a_queued_folder_claims_the_window_so_the_next_one_spawns() {
        let registry = WindowRegistry::new();
        registry.set_workspace("main", None);
        registry.deliver("main", file("/a.md"));
        assert_eq!(
            registry.snapshot().workspaces,
            vec![("main".to_string(), None)],
            "a queued file claims nothing"
        );

        registry.deliver("main", folder("/ws"));
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
    fn a_folder_emitted_to_a_listening_window_claims_nothing() {
        // That window reports its own workspace once it has adopted the
        // folder, and reports nothing if it refuses it.
        let registry = WindowRegistry::new();
        registry.take_pending("main");

        assert_eq!(registry.deliver("main", folder("/ws")), Some(folder("/ws")));
        assert!(registry.snapshot().workspaces.is_empty());
    }

    #[test]
    fn a_closed_window_forgets_its_queue_and_stops_listening() {
        let registry = WindowRegistry::new();
        registry.deliver("w1", file("/a.md"));
        registry.remove("w1");
        assert!(registry.take_pending("w1").is_empty());

        // The label is listening after that take; closing resets it too.
        registry.remove("w1");
        assert_eq!(registry.deliver("w1", file("/b.md")), None);
    }
}
