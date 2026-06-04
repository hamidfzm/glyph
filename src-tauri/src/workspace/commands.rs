//! Tauri command surface for the workspace module.
//!
//! Thin wrappers over [`super::resolve`] and [`super::config`] /
//! [`super::paths`]. Sync (not async) to match the filesystem commands in
//! `commands/file.rs`; each is a small single-file or git-discovery call.

use std::path::Path;

use super::config::{read_state, write_state};
use super::paths::{from_workspace_relative, to_workspace_relative};
use super::resolve::{resolve_workspace, WorkspaceResolution};

/// Resolve a selected folder for the "one folder = one workspace" guard (#262).
#[tauri::command]
pub fn workspace_resolve(selected: String) -> Result<WorkspaceResolution, String> {
    resolve_workspace(Path::new(&selected))
}

/// Return the workspace's last-opened file as an ABSOLUTE path (so the caller
/// can compare it against the workspace file list directly), or `None`.
#[tauri::command]
pub fn workspace_get_last_file(workspace_root: String) -> Result<Option<String>, String> {
    let root = Path::new(&workspace_root);
    let state = read_state(root)?;
    match state.last_file {
        Some(rel) => Ok(Some(
            from_workspace_relative(root, &rel)?
                .to_string_lossy()
                .to_string(),
        )),
        None => Ok(None),
    }
}

/// Record `file_path` (absolute) as the workspace's last-opened file, stored
/// relative to the workspace root. `Err` when the file isn't inside the workspace.
#[tauri::command]
pub fn workspace_set_last_file(workspace_root: String, file_path: String) -> Result<(), String> {
    let root = Path::new(&workspace_root);
    let rel = to_workspace_relative(root, Path::new(&file_path))?;
    let mut state = read_state(root)?;
    state.last_file = Some(rel);
    write_state(root, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn last_file_round_trips_as_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let file = tmp.path().join("notes").join("a.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();

        assert!(workspace_get_last_file(root.clone()).unwrap().is_none());

        workspace_set_last_file(root.clone(), file.to_string_lossy().to_string()).unwrap();

        // Stored relative on disk...
        let raw = std::fs::read_to_string(tmp.path().join(".glyph/state.json")).unwrap();
        assert!(raw.contains("notes/a.md"));
        assert!(!raw.contains(&root));

        // ...returned absolute.
        let got = workspace_get_last_file(root).unwrap().unwrap();
        assert_eq!(Path::new(&got), file);
    }

    #[test]
    fn set_last_file_rejects_a_file_outside_the_workspace() {
        let tmp = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        let outside = other.path().join("x.md");
        let err = workspace_set_last_file(
            tmp.path().to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        );
        assert!(err.is_err());
    }

    #[test]
    fn resolve_reports_a_plain_folder() {
        let tmp = TempDir::new().unwrap();
        let r = workspace_resolve(tmp.path().to_string_lossy().to_string()).unwrap();
        assert!(!r.is_git_repo);
        assert!(r.nested_under.is_none());
    }
}
