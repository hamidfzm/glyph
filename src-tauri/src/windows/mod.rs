// Multi-window routing for "open this path" requests (CLI, second instance,
// macOS `Opened`, drag-drop, the in-app Open Folder dialog, and the explicit
// "Open in new window" action).
//
// One window owns at most one folder workspace, and a file is shown by at most
// one window (the VS Code model). Opening a *different* folder spawns a new
// window rather than replacing the current one; opening a folder or file that
// is already shown focuses the window showing it. This module is the pure
// half: the `WindowRegistry` (which window shows what) plus the `route_open`
// decision. The runtime half (creating/focusing/emitting to real windows)
// lives in [`crate::windows_runtime`].

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

/// Where an open request is allowed to land.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenTarget {
    /// Default routing: adopt into the current window where that makes sense.
    Current,
    /// An explicit "open in new window" request: never adopt into the current
    /// window, but still focus a window that already shows the path.
    NewWindow,
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

/// What every open window currently shows, as one consistent snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WindowsSnapshot {
    /// (window label, the folder workspace it owns, if any)
    pub workspaces: Vec<(String, Option<String>)>,
    /// (window label, the file paths it has open)
    pub files: Vec<(String, Vec<String>)>,
}

impl WindowsSnapshot {
    /// The window showing `path` as a file tab, skipping `except` so a caller
    /// can ask whether anyone *else* has it. Ties are broken by label so the
    /// answer is deterministic rather than map order.
    pub fn window_with_file(&self, path: &str, except: &str) -> Option<&str> {
        self.files
            .iter()
            .filter(|(label, paths)| label != except && paths.iter().any(|p| p == path))
            .map(|(label, _)| label.as_str())
            .min()
    }

    /// The window owning `root` as its workspace, if any.
    fn window_with_workspace(&self, root: &str) -> Option<&str> {
        self.workspaces
            .iter()
            .filter(|(_, workspace)| workspace.as_deref() == Some(root))
            .map(|(label, _)| label.as_str())
            .min()
    }

    fn has_workspace(&self, label: &str) -> bool {
        self.workspaces
            .iter()
            .any(|(l, workspace)| l == label && workspace.is_some())
    }
}

/// Decide how to handle an open request, given what each window currently shows
/// and which window is "current" (the in-app caller, or the focused window for
/// OS-level launches).
///
/// A path is shown by at most one window, so a request for something another
/// window already has focuses that window. Beyond that:
///
/// - A **file** opens as a loose tab in the current window, or in a new window
///   when the caller asked for one.
/// - A **folder** already shown somewhere focuses that window. Otherwise an
///   empty current window adopts it and an occupied one spawns; an explicit
///   new-window request skips the adopt-into-empty step.
pub fn route_open(
    kind: OpenKind,
    path: &str,
    snapshot: &WindowsSnapshot,
    current_label: &str,
    target: OpenTarget,
) -> OpenRoute {
    let pending = PendingOpen {
        kind,
        path: path.to_string(),
    };

    if kind == OpenKind::File {
        // Another window already shows this file: focus it rather than opening
        // a second live buffer over one path. Two windows editing one file
        // means two autosave chains, and the later write silently discards the
        // other window's edits (INV-1, INV-3).
        if let Some(label) = snapshot.window_with_file(path, current_label) {
            return OpenRoute::Focus(label.to_string());
        }
        return match target {
            // The current window may already have the tab; `open-file` there
            // activates the existing one instead of duplicating it.
            OpenTarget::Current => OpenRoute::Adopt(current_label.to_string(), pending),
            // The caller asked for a new window. When the file is open here the
            // frontend closes that tab first, so the note moves rather than
            // being shown twice.
            OpenTarget::NewWindow => OpenRoute::NewWindow(pending),
        };
    }

    if let Some(label) = snapshot.window_with_workspace(path) {
        return OpenRoute::Focus(label.to_string());
    }
    if target == OpenTarget::NewWindow || snapshot.has_workspace(current_label) {
        OpenRoute::NewWindow(pending)
    } else {
        OpenRoute::Adopt(current_label.to_string(), pending)
    }
}

/// Tracks what each window currently shows (its folder workspace and its open
/// file tabs), plus a counter for minting unique labels for spawned windows.
/// The frontend keeps the maps current via the `set_window_workspace` and
/// `set_window_files` commands.
#[derive(Default)]
pub struct WindowRegistry {
    inner: Mutex<Windows>,
    counter: AtomicU64,
}

/// Both maps live under one lock so a routing snapshot cannot see a window's
/// workspace without its files, or the other way round.
#[derive(Default)]
struct Windows {
    workspaces: HashMap<String, Option<String>>,
    files: HashMap<String, Vec<String>>,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record (or clear) the workspace a window shows.
    pub fn set_workspace(&self, label: &str, root: Option<String>) {
        self.inner
            .lock()
            .unwrap()
            .workspaces
            .insert(label.to_string(), root);
    }

    /// Record the full set of file tabs a window has open.
    pub fn set_files(&self, label: &str, paths: Vec<String>) {
        self.inner
            .lock()
            .unwrap()
            .files
            .insert(label.to_string(), paths);
    }

    /// Register one file against a window before that window can report for
    /// itself. A spawned window only reports once its frontend has mounted, so
    /// without this a second request in that gap spawns a duplicate window.
    pub fn add_file(&self, label: &str, path: String) {
        let mut windows = self.inner.lock().unwrap();
        let paths = windows.files.entry(label.to_string()).or_default();
        if !paths.contains(&path) {
            paths.push(path);
        }
    }

    /// Every path a window is responsible for: its workspace root plus its
    /// file tabs. A path is shown by at most one window, so this is also the
    /// set of watches to release when the window closes.
    pub fn owned_paths(&self, label: &str) -> Vec<String> {
        let windows = self.inner.lock().unwrap();
        let mut paths: Vec<String> = windows
            .files
            .get(label)
            .map(|paths| paths.to_vec())
            .unwrap_or_default();
        if let Some(Some(root)) = windows.workspaces.get(label) {
            paths.push(root.clone());
        }
        paths
    }

    /// Drop one file from a window's set. The "open in new window" action calls
    /// this for the window it is moving a note *out of*, so the move is visible
    /// to routing immediately rather than whenever that window's next report
    /// lands, which the spawned window would otherwise race.
    pub fn remove_file(&self, label: &str, path: &str) {
        if let Some(paths) = self.inner.lock().unwrap().files.get_mut(label) {
            paths.retain(|p| p != path);
        }
    }

    /// Forget a window that has closed.
    pub fn remove(&self, label: &str) {
        let mut windows = self.inner.lock().unwrap();
        windows.workspaces.remove(label);
        windows.files.remove(label);
    }

    /// A stable snapshot of what every window shows, for routing.
    pub fn snapshot(&self) -> WindowsSnapshot {
        let windows = self.inner.lock().unwrap();
        WindowsSnapshot {
            workspaces: windows
                .workspaces
                .iter()
                .map(|(label, root)| (label.clone(), root.clone()))
                .collect(),
            files: windows
                .files
                .iter()
                .map(|(label, paths)| (label.clone(), paths.clone()))
                .collect(),
        }
    }

    /// Mint a unique label for a new window (`w1`, `w2`, …). `main` is reserved
    /// for the first window, so spawned labels never collide with it.
    pub fn next_label(&self) -> String {
        format!("w{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

#[cfg(test)]
mod tests;
