//! "Show in system explorer", in place of the opener plugin's own
//! `reveal_item_in_dir`, which looks up whatever path the renderer names under
//! no scope.

use tauri::State;

use crate::grants::GrantRegistry;

/// Show a path the session holds a grant on in the system file manager. Any
/// grant will do, as nothing is handed back: `ensure_writable` admits all that
/// `ensure_readable` does, and a document just saved under a new name besides.
#[tauri::command]
pub async fn reveal_path(path: String, grants: State<'_, GrantRegistry>) -> Result<(), String> {
    grants.ensure_writable(&path)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

// Every path below names a file that is not there, which the plugin reports
// before it reaches the file manager: none opens, even with the check gone.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::test_support::app_with_workspace;
    use std::path::Path;
    use tauri::async_runtime::block_on;
    use tauri::test::MockRuntime;
    use tauri::Manager;
    use tempfile::TempDir;

    const DENIED: &str = "path is outside the allowed workspaces and files:";

    fn reveal(app: &tauri::App<MockRuntime>, path: &Path) -> Result<(), String> {
        let path = path.to_string_lossy().to_string();
        block_on(reveal_path(path, app.state::<GrantRegistry>()))
    }

    #[test]
    fn a_path_no_grant_covers_is_refused() {
        let workspace = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let app = app_with_workspace(workspace.path());

        let denial = reveal(&app, &elsewhere.path().join("note.md")).unwrap_err();
        assert!(denial.starts_with(DENIED), "unexpected message: {denial}");
    }

    #[test]
    fn a_granted_path_is_handed_to_the_file_manager() {
        let workspace = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let app = app_with_workspace(workspace.path());
        // What Save As leaves a new document with: a grant to write, not to read.
        let saved_as = elsewhere.path().join("new.md");
        app.state::<GrantRegistry>()
            .grant_export_file(&saved_as)
            .unwrap();

        for path in [workspace.path().join("gone.md"), saved_as] {
            let failure = reveal(&app, &path).unwrap_err();
            assert!(!failure.starts_with(DENIED), "{failure}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_network_or_device_path_is_never_looked_up() {
        let workspace = TempDir::new().unwrap();
        let app = app_with_workspace(workspace.path());
        for path in crate::grants::NEVER_LOOKED_UP {
            let refusal = reveal(&app, Path::new(path)).unwrap_err();
            assert!(refusal.contains("never looked up"), "{refusal}");
        }
    }
}
