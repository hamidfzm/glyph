// Multi-window routing for "open this path" requests (CLI, second instance,
// macOS `Opened`, drag-drop, and the in-app Open Folder dialog).
//
// One window owns at most one folder workspace (the VS Code model). Opening a
// *different* folder spawns a new window rather than replacing the current one;
// opening a folder that's already shown focuses that window; a single file
// opens as a loose tab in the active window. This module is the pure half:
// the `WindowRegistry` (which window shows which workspace) plus the
// `route_open` decision. The runtime half (creating/focusing/emitting to real
// windows) lives in [`crate::windows_runtime`].

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

/// Whether an open request targets a folder workspace or a single file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenKind {
    Folder,
    File,
}

/// A pending open handed to a freshly-spawned window via its init script; the
/// frontend reads it from `window.__GLYPH_OPEN__` on mount.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOpen {
    pub kind: OpenKind,
    pub path: String,
}

/// What the runtime should do for an open request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenRoute {
    /// Bring an existing window (by label) to the front; it already shows this.
    Focus(String),
    /// Tell an existing window (by label) to load this path itself.
    Adopt(String, PendingOpen),
    /// Spawn a new window for this path.
    NewWindow(PendingOpen),
}

/// Decide how to handle an open request, given which workspace each open window
/// currently shows and which window is "current" (the in-app caller, or the
/// focused window for OS-level launches).
///
/// - A **file** always opens as a loose tab in the current window.
/// - A **folder** already shown in some window focuses that window.
/// - Otherwise, if the current window has no workspace it adopts the folder;
///   if it already owns a different workspace, a new window is spawned.
pub fn route_open(
    kind: OpenKind,
    path: &str,
    workspaces: &[(String, Option<String>)],
    current_label: &str,
) -> OpenRoute {
    if kind == OpenKind::File {
        return OpenRoute::Adopt(
            current_label.to_string(),
            PendingOpen {
                kind: OpenKind::File,
                path: path.to_string(),
            },
        );
    }

    // Folder: focus a window already showing exactly this root.
    for (label, workspace) in workspaces {
        if workspace.as_deref() == Some(path) {
            return OpenRoute::Focus(label.clone());
        }
    }

    let pending = PendingOpen {
        kind: OpenKind::Folder,
        path: path.to_string(),
    };
    // An empty current window adopts the folder; an occupied one spawns a new
    // window so its workspace is never silently replaced.
    let current_has_workspace = workspaces
        .iter()
        .any(|(label, ws)| label == current_label && ws.is_some());
    if current_has_workspace {
        OpenRoute::NewWindow(pending)
    } else {
        OpenRoute::Adopt(current_label.to_string(), pending)
    }
}

/// Tracks which folder workspace each window currently shows, plus a counter
/// for minting unique labels for spawned windows. The frontend keeps the map
/// current via the `set_window_workspace` command.
pub struct WindowRegistry {
    workspaces: Mutex<HashMap<String, Option<String>>>,
    counter: AtomicU64,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self {
            workspaces: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        }
    }

    /// Record (or clear) the workspace a window shows.
    pub fn set_workspace(&self, label: &str, root: Option<String>) {
        self.workspaces
            .lock()
            .unwrap()
            .insert(label.to_string(), root);
    }

    /// Forget a window that has closed.
    pub fn remove(&self, label: &str) {
        self.workspaces.lock().unwrap().remove(label);
    }

    /// A stable snapshot of (label, workspace) pairs for routing.
    pub fn snapshot(&self) -> Vec<(String, Option<String>)> {
        self.workspaces
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Mint a unique label for a new window (`w1`, `w2`, …). `main` is reserved
    /// for the first window, so spawned labels never collide with it.
    pub fn next_label(&self) -> String {
        format!("w{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

impl Default for WindowRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(pairs: &[(&str, Option<&str>)]) -> Vec<(String, Option<String>)> {
        pairs
            .iter()
            .map(|(l, w)| (l.to_string(), w.map(str::to_string)))
            .collect()
    }

    #[test]
    fn file_always_opens_in_the_current_window() {
        let route = route_open(OpenKind::File, "/a/note.md", &ws(&[("main", None)]), "main");
        assert_eq!(
            route,
            OpenRoute::Adopt(
                "main".to_string(),
                PendingOpen {
                    kind: OpenKind::File,
                    path: "/a/note.md".to_string()
                }
            )
        );
    }

    #[test]
    fn folder_already_open_focuses_that_window() {
        let workspaces = ws(&[("main", Some("/a")), ("w1", Some("/b"))]);
        assert_eq!(
            route_open(OpenKind::Folder, "/b", &workspaces, "main"),
            OpenRoute::Focus("w1".to_string())
        );
    }

    #[test]
    fn folder_in_an_empty_current_window_is_adopted() {
        let route = route_open(OpenKind::Folder, "/b", &ws(&[("main", None)]), "main");
        assert_eq!(
            route,
            OpenRoute::Adopt(
                "main".to_string(),
                PendingOpen {
                    kind: OpenKind::Folder,
                    path: "/b".to_string()
                }
            )
        );
    }

    #[test]
    fn folder_with_an_occupied_current_window_spawns_a_new_window() {
        let route = route_open(OpenKind::Folder, "/b", &ws(&[("main", Some("/a"))]), "main");
        assert_eq!(
            route,
            OpenRoute::NewWindow(PendingOpen {
                kind: OpenKind::Folder,
                path: "/b".to_string()
            })
        );
    }

    #[test]
    fn current_window_absent_from_registry_counts_as_empty() {
        // A window that hasn't reported its workspace yet adopts rather than
        // spawning a redundant window.
        let route = route_open(OpenKind::Folder, "/b", &ws(&[("w1", Some("/a"))]), "main");
        assert_eq!(
            route,
            OpenRoute::Adopt(
                "main".to_string(),
                PendingOpen {
                    kind: OpenKind::Folder,
                    path: "/b".to_string()
                }
            )
        );
    }

    #[test]
    fn focus_takes_priority_even_when_current_window_is_occupied() {
        let workspaces = ws(&[("main", Some("/a")), ("w1", Some("/b"))]);
        // Re-opening /a from main's occupied window focuses main, not a new one.
        assert_eq!(
            route_open(OpenKind::Folder, "/a", &workspaces, "main"),
            OpenRoute::Focus("main".to_string())
        );
    }

    #[test]
    fn registry_tracks_set_remove_and_snapshot() {
        let reg = WindowRegistry::new();
        reg.set_workspace("main", Some("/a".to_string()));
        reg.set_workspace("w1", None);
        let mut snap = reg.snapshot();
        snap.sort();
        assert_eq!(
            snap,
            vec![
                ("main".to_string(), Some("/a".to_string())),
                ("w1".to_string(), None),
            ]
        );
        reg.remove("w1");
        assert_eq!(
            reg.snapshot(),
            vec![("main".to_string(), Some("/a".to_string()))]
        );
    }

    #[test]
    fn next_label_is_unique_and_never_main() {
        let reg = WindowRegistry::new();
        let a = reg.next_label();
        let b = reg.next_label();
        assert_ne!(a, b);
        assert_ne!(a, "main");
        assert_ne!(b, "main");
    }

    #[test]
    fn default_registry_is_empty() {
        let reg = WindowRegistry::default();
        assert!(reg.snapshot().is_empty());
    }
}
