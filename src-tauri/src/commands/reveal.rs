//! "Show in system explorer", in place of the opener plugin's own
//! `reveal_item_in_dir`, which looks up whatever path the renderer names under
//! no scope.

use tauri::State;

use crate::grants::GrantRegistry;

/// Show a path the session may read in the system file manager. The file
/// manager answers off the main thread, which it can keep waiting.
#[tauri::command]
pub fn reveal_path(path: String, grants: State<'_, GrantRegistry>) -> Result<(), String> {
    grants.ensure_readable(&path)?;
    tauri::async_runtime::spawn_blocking(move || tauri_plugin_opener::reveal_item_in_dir(path));
    Ok(())
}

// Every path below names a file that is not there, which the plugin reports
// before it reaches the file manager: none opens, even with the check gone.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::test_support::app_with_workspace;
    use std::path::Path;
    use tauri::test::MockRuntime;
    use tauri::Manager;
    use tempfile::TempDir;

    fn reveal(app: &tauri::App<MockRuntime>, path: &Path) -> Result<(), String> {
        let path = path.to_string_lossy().to_string();
        reveal_path(path, app.state::<GrantRegistry>())
    }

    #[test]
    fn a_path_the_session_cannot_read_is_refused() {
        let workspace = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let app = app_with_workspace(workspace.path());
        // An export target is granted to write, not to read.
        let exported = elsewhere.path().join("new.pdf");
        app.state::<GrantRegistry>()
            .grant_export_file(&exported)
            .unwrap();

        for path in [elsewhere.path().join("note.md"), exported] {
            let denial = reveal(&app, &path).unwrap_err();
            assert!(
                denial.starts_with("path is outside the allowed workspaces and files:"),
                "unexpected message for {path:?}: {denial}"
            );
        }
    }

    #[test]
    fn a_readable_path_is_handed_to_the_file_manager() {
        let workspace = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let app = app_with_workspace(workspace.path());
        let saved_as = elsewhere.path().join("new.md");
        app.state::<GrantRegistry>()
            .grant_document_target(&saved_as)
            .unwrap();

        for path in [workspace.path().join("gone.md"), saved_as] {
            assert_eq!(reveal(&app, &path), Ok(()), "{path:?}");
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
