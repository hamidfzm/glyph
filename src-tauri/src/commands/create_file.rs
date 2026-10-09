//! Create a file in a workspace without ever replacing one: the host service
//! behind the plugin API's `workspace.createFile`.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::grants::GrantRegistry;
use crate::workspace::paths::{from_workspace_relative, to_workspace_relative};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedFile {
    pub path: String,
    /// False when a file was already there and was left as it is.
    pub created: bool,
}

/// False when a file is already at `target`: `create_new` never replaces one,
/// so overlapping requests for the same path cannot overwrite each other.
fn write_new(target: &Path, content: &str) -> Result<bool, String> {
    match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .map(|()| true)
            .map_err(|e| format!("Failed to write the file: {e}")),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("Failed to create the file: {e}")),
    }
}

/// Create the file at the workspace-relative `path` with `content`, along with
/// any folders it needs. A file that is already there is reported, not written.
#[tauri::command]
pub fn create_workspace_file(
    root: String,
    path: String,
    content: String,
    grants: State<'_, GrantRegistry>,
) -> Result<CreatedFile, String> {
    let canonical_root = grants.ensure_workspace(&root)?;
    let root = Path::new(&root);
    let requested = from_workspace_relative(root, &path)?;
    let target = grants.ensure_writable(&requested.to_string_lossy())?;
    // Errors when a symlink led out of this workspace: a grant on another one
    // is not enough. Respelled as on disk, so the path equals the file tree's
    // even where the request differs in case.
    let on_disk = to_workspace_relative(&canonical_root, &target)?;
    // Dot-prefixed names hold what other tools run or trust (`.git/hooks`, `.glyph`).
    if on_disk.split('/').any(|segment| segment.starts_with('.')) {
        return Err("Refusing to create a hidden file or a file in a hidden folder".to_string());
    }
    let path = from_workspace_relative(root, &on_disk)?
        .to_string_lossy()
        .to_string();

    if target.is_dir() {
        return Err("A folder already has that name".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create the folder: {e}"))?;
    }
    let created = write_new(&target, &content)?;
    Ok(CreatedFile { path, created })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;
    use tempfile::TempDir;

    fn app_with_root(root: &Path) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>().grant_workspace(root).unwrap();
        app
    }

    // Shadows the command so each test runs it with `root` granted.
    fn create_workspace_file(
        root: &Path,
        path: &str,
        content: &str,
    ) -> Result<CreatedFile, String> {
        let app = app_with_root(root);
        super::create_workspace_file(
            root.to_string_lossy().to_string(),
            path.to_string(),
            content.to_string(),
            app.state::<GrantRegistry>(),
        )
    }

    #[test]
    fn creates_the_file_with_its_content_and_missing_folders() {
        let tmp = TempDir::new().unwrap();
        let file =
            create_workspace_file(tmp.path(), "daily/2026/2026-10-08.md", "# Today\n").unwrap();

        let expected = tmp.path().join("daily").join("2026").join("2026-10-08.md");
        assert!(file.created);
        // Spelled from the root as passed, not its canonical form.
        assert_eq!(Path::new(&file.path), expected);
        assert_eq!(fs::read_to_string(expected).unwrap(), "# Today\n");
    }

    #[test]
    fn an_existing_file_is_reported_untouched() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("daily")).unwrap();
        let existing = tmp.path().join("daily/2026-10-08.md");
        fs::write(&existing, "what I wrote this morning").unwrap();

        let file = create_workspace_file(tmp.path(), "daily/2026-10-08.md", "template").unwrap();

        assert!(!file.created);
        assert_eq!(Path::new(&file.path), existing);
        assert_eq!(
            fs::read_to_string(&existing).unwrap(),
            "what I wrote this morning"
        );
    }

    #[test]
    fn write_new_never_replaces_a_file_that_is_already_there() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("2026-10-08.md");

        assert_eq!(write_new(&target, "first"), Ok(true));
        assert_eq!(write_new(&target, "second"), Ok(false));
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");
    }

    #[test]
    fn write_new_reports_a_failure_that_is_not_an_existing_file() {
        let tmp = TempDir::new().unwrap();
        let err = write_new(&tmp.path().join("missing/2026-10-08.md"), "x").unwrap_err();
        assert!(err.contains("Failed to create"), "{err}");
    }

    #[test]
    fn a_file_where_the_folder_should_be_is_reported() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("daily"), "not a folder").unwrap();

        let err = create_workspace_file(tmp.path(), "daily/2026-10-08.md", "").unwrap_err();

        assert!(err.contains("folder"), "{err}");
        assert_eq!(
            fs::read_to_string(tmp.path().join("daily")).unwrap(),
            "not a folder"
        );
    }

    #[test]
    fn a_path_leaving_the_workspace_is_refused() {
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        fs::create_dir_all(&ws).unwrap();

        assert!(create_workspace_file(&ws, "../escape.md", "").is_err());
        assert!(create_workspace_file(&ws, "daily/../../escape.md", "").is_err());
        assert!(!outer.path().join("escape.md").exists());
    }

    #[test]
    fn the_workspace_root_is_not_a_file() {
        let tmp = TempDir::new().unwrap();
        for path in ["", "."] {
            let err = create_workspace_file(tmp.path(), path, "").unwrap_err();
            assert!(err.contains("workspace root"), "{err}");
        }
    }

    #[test]
    fn a_folder_with_that_name_is_refused() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("daily/2026-10-08.md")).unwrap();

        let err = create_workspace_file(tmp.path(), "daily/2026-10-08.md", "").unwrap_err();

        assert!(err.contains("folder already has"), "{err}");
    }

    // A git hook is run by the user's own git, and `.glyph` holds the
    // workspace's settings: neither is a plugin's to plant.
    #[test]
    fn hidden_files_and_folders_are_refused() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".git/hooks")).unwrap();

        for path in [
            ".git/hooks/pre-commit",
            ".glyph/site.json",
            "notes/.env",
            ".hidden.md",
        ] {
            let err = create_workspace_file(tmp.path(), path, "x").unwrap_err();
            assert!(err.contains("hidden"), "{path}: {err}");
        }
        assert!(!tmp.path().join(".git/hooks/pre-commit").exists());
        assert!(!tmp.path().join(".glyph").exists());
        assert!(!tmp.path().join("notes").exists());
    }

    #[test]
    fn a_dot_inside_a_name_is_not_hidden() {
        let tmp = TempDir::new().unwrap();
        let file = create_workspace_file(tmp.path(), "./notes/v1.2/2026.10.08.md", "").unwrap();
        assert!(file.created);
    }

    #[test]
    fn an_ungranted_workspace_is_refused() {
        let tmp = TempDir::new().unwrap();
        let app = mock_app();
        app.manage(GrantRegistry::default());

        let result = super::create_workspace_file(
            tmp.path().to_string_lossy().to_string(),
            "2026-10-08.md".to_string(),
            String::new(),
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(!tmp.path().join("2026-10-08.md").exists());
    }

    #[test]
    fn a_folder_inside_a_workspace_is_not_a_root() {
        // The root must be the granted workspace itself, so a caller cannot
        // re-root the relative path at a subfolder of its choosing.
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        let app = app_with_root(tmp.path());

        let result = super::create_workspace_file(
            sub.to_string_lossy().to_string(),
            "2026-10-08.md".to_string(),
            String::new(),
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(!sub.join("2026-10-08.md").exists());
    }

    // A case-insensitive filesystem resolves `daily` to an existing `Daily`;
    // reporting the request's spelling would open a second tab on a file the
    // file tree lists under the folder's real name.
    #[cfg(windows)]
    #[test]
    fn the_path_uses_the_folder_s_spelling_on_disk() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("Daily")).unwrap();

        let file = create_workspace_file(tmp.path(), "daily/2026-10-08.md", "").unwrap();

        assert_eq!(
            Path::new(&file.path),
            tmp.path().join("Daily").join("2026-10-08.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_behind_a_symlinked_folder_is_reported_where_it_really_is() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("journal")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("journal"), tmp.path().join("daily")).unwrap();

        let file = create_workspace_file(tmp.path(), "daily/2026-10-08.md", "").unwrap();

        assert!(file.created);
        assert_eq!(
            Path::new(&file.path),
            tmp.path().join("journal").join("2026-10-08.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_resolving_outside_is_refused() {
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        let elsewhere = outer.path().join("elsewhere");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, ws.join("daily")).unwrap();

        assert!(create_workspace_file(&ws, "daily/2026-10-08.md", "").is_err());
        assert!(!elsewhere.join("2026-10-08.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_into_another_granted_workspace_is_refused() {
        // Writable is not enough: the file belongs to this workspace.
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        let other = outer.path().join("other");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&other).unwrap();
        std::os::unix::fs::symlink(&other, ws.join("daily")).unwrap();
        let app = app_with_root(&ws);
        app.state::<GrantRegistry>()
            .grant_workspace(&other)
            .unwrap();

        let result = super::create_workspace_file(
            ws.to_string_lossy().to_string(),
            "daily/2026-10-08.md".to_string(),
            String::new(),
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(!other.join("2026-10-08.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_resolving_into_a_hidden_folder_is_refused() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".git/hooks")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join(".git/hooks"), tmp.path().join("notes"))
            .unwrap();

        let err = create_workspace_file(tmp.path(), "notes/pre-commit", "x").unwrap_err();

        assert!(err.contains("hidden"), "{err}");
        assert!(!tmp.path().join(".git/hooks/pre-commit").exists());
    }
}
