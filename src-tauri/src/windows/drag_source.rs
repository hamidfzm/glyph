//! Whether the drag over a window began in this app, which decides if a drop
//! on it may be trusted.
//!
//! A drop is a backend-observed event: the OS hands wry the dropped paths and
//! the renderer never sees them, so the drop handler mints a grant for the
//! folder or file dropped. On Linux that observation is not enough. WebKitGTK
//! serves the page's own drags through the same GTK drag the file manager
//! uses, and wry reads any `text/uri-list` that reaches the webview as a file
//! drop without asking where the drag came from. A page that writes
//! `file:///home/user` into `dataTransfer` in a `dragstart` listener and is
//! dropped on itself (one mouse drag inside the window) thereby names the path
//! the handler would grant as a workspace.
//!
//! GTK knows whether a drag began in this process (`gtk_drag_get_source_widget`
//! answers only for drags it started itself), so the runtime asks it at every
//! `drag-motion` over the webview and records the answer here. That signal
//! runs on the drop target before wry queues the drop, so the record always
//! describes the drag the drop belongs to, whatever the event loop does with
//! the source side's `drag-end` later. The drop handler then refuses a drop
//! while the record says the drag is the app's own.
//!
//! Windows and macOS read only the OS file list (`CF_HDROP`,
//! `NSFilenamesPboardType`), which a page cannot write, so nothing is recorded
//! there and every drop is honoured.

use std::collections::HashSet;
use std::sync::Mutex;

/// Per-window record of whether the drag moving over it began in this app.
#[derive(Debug, Default)]
pub struct DragSources {
    /// Labels of the windows whose current, or most recent, drag began here.
    own: Mutex<HashSet<String>>,
}

impl DragSources {
    /// Record what GTK said about the drag moving over `label`: `own` when the
    /// drag began in this process.
    pub fn record(&self, label: &str, own: bool) {
        let mut labels = self.own.lock().unwrap();
        if own {
            labels.insert(label.to_string());
        } else {
            labels.remove(label);
        }
    }

    /// Whether a drop on `label` may be honoured: only while nothing says the
    /// drag began in this app. A window no drag was recorded for accepts.
    pub fn accepts_drop(&self, label: &str) -> bool {
        !self.own.lock().unwrap().contains(label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_without_a_record_accepts_drops() {
        let sources = DragSources::default();
        assert!(sources.accepts_drop("main"));
    }

    #[test]
    fn a_drag_that_began_in_the_app_refuses_the_drop() {
        let sources = DragSources::default();
        sources.record("main", true);
        assert!(!sources.accepts_drop("main"));
    }

    #[test]
    fn the_next_drag_from_outside_accepts_again() {
        let sources = DragSources::default();
        sources.record("main", true);
        sources.record("main", false);
        assert!(sources.accepts_drop("main"));
    }

    #[test]
    fn the_record_is_per_window() {
        let sources = DragSources::default();
        sources.record("w1", true);
        assert!(!sources.accepts_drop("w1"));
        assert!(sources.accepts_drop("main"));
    }
}
