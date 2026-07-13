//! Tauri command surface for the workspace module.
//!
//! Thin wrappers over [`super::resolve`] and [`super::config`] /
//! [`super::paths`]. Sync (not async) to match the filesystem commands in
//! `commands/file.rs`; each is a small single-file or git-discovery call.

use std::path::Path;
use tauri::State;

use crate::grants::GrantRegistry;

use super::config::{read_config, read_state, write_state};
use super::paths::{from_workspace_relative, to_workspace_relative};
use super::resolve::{resolve_workspace, WorkspaceResolution};

/// Resolve a selected folder for the "one folder = one workspace" guard (#262).
///
/// Deliberately not grant-gated: this is the pre-open probe that runs on a
/// folder BEFORE it becomes a workspace (the grant is minted when the open is
/// routed). It only canonicalizes and inspects to decide adoption; it neither
/// reads document content nor writes anything.
#[tauri::command]
pub fn workspace_resolve(selected: String) -> Result<WorkspaceResolution, String> {
    resolve_workspace(Path::new(&selected))
}

/// Return the workspace's last-opened file as an ABSOLUTE path (so the caller
/// can compare it against the workspace file list directly), or `None`.
#[tauri::command]
pub fn workspace_get_last_file(
    workspace_root: String,
    grants: State<'_, GrantRegistry>,
) -> Result<Option<String>, String> {
    grants.ensure_workspace(&workspace_root)?;
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
///
/// No-op for a plain folder that hasn't been turned into a workspace yet
/// (no `.glyph/config.json`): we never materialize `.glyph/` just because the
/// user browsed a file. The directory only gains Glyph state once it has been
/// explicitly enabled (e.g. by configuring Cloud Sync), which is what writes
/// `config.json` in the first place.
#[tauri::command]
pub fn workspace_set_last_file(
    workspace_root: String,
    file_path: String,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    grants.ensure_workspace(&workspace_root)?;
    let root = Path::new(&workspace_root);
    if read_config(root)?.is_none() {
        return Ok(());
    }
    let rel = to_workspace_relative(root, Path::new(&file_path))?;
    let mut state = read_state(root)?;
    state.last_file = Some(rel);
    write_state(root, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::config::{write_config, WorkspaceConfig};
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;
    use tempfile::TempDir;

    /// Mock app with `root` granted as a workspace.
    fn app_with_root(root: &str) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>()
            .grant_workspace(Path::new(root))
            .unwrap();
        app
    }

    // Shadow the real commands so the pre-grant test bodies run against a
    // registry where `root` is a granted workspace.
    fn workspace_get_last_file(workspace_root: String) -> Result<Option<String>, String> {
        let app = app_with_root(&workspace_root);
        super::workspace_get_last_file(workspace_root, app.state::<GrantRegistry>())
    }

    fn workspace_set_last_file(workspace_root: String, file_path: String) -> Result<(), String> {
        let app = app_with_root(&workspace_root);
        super::workspace_set_last_file(workspace_root, file_path, app.state::<GrantRegistry>())
    }

    /// Mark a folder as an enabled workspace by writing a `.glyph/config.json`,
    /// mirroring what configuring Cloud Sync does.
    fn enable_workspace(root: &Path) {
        write_config(root, &WorkspaceConfig::default()).unwrap();
    }

    #[test]
    fn last_file_round_trips_as_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let file = tmp.path().join("notes").join("a.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        enable_workspace(tmp.path());

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
        enable_workspace(tmp.path());
        let other = TempDir::new().unwrap();
        let outside = other.path().join("x.md");
        let err = workspace_set_last_file(
            tmp.path().to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        );
        assert!(err.is_err());
    }

    #[test]
    fn set_last_file_is_a_noop_for_a_plain_folder() {
        // A folder that hasn't been turned into a workspace must not gain a
        // `.glyph/` directory just because the user opened a file in it.
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        std::fs::write(&file, "# hi").unwrap();

        workspace_set_last_file(
            tmp.path().to_string_lossy().to_string(),
            file.to_string_lossy().to_string(),
        )
        .unwrap();

        assert!(!tmp.path().join(".glyph").exists());
    }

    #[test]
    fn last_file_commands_require_a_granted_workspace() {
        let tmp = TempDir::new().unwrap();
        enable_workspace(tmp.path());
        let root = tmp.path().to_string_lossy().to_string();
        let app = mock_app();
        app.manage(GrantRegistry::default());

        let read = super::workspace_get_last_file(root.clone(), app.state::<GrantRegistry>());
        assert!(read.is_err());
        let write = super::workspace_set_last_file(
            root.clone(),
            tmp.path().join("a.md").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(write.is_err());
    }

    #[test]
    fn resolve_reports_a_plain_folder() {
        let tmp = TempDir::new().unwrap();
        let r = workspace_resolve(tmp.path().to_string_lossy().to_string()).unwrap();
        assert!(!r.is_git_repo);
        assert!(r.nested_under.is_none());
    }
}
