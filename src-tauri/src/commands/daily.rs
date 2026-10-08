//! Create the daily note behind "Open Today's Note". The frontend resolves the
//! date into a workspace-relative path; this side keeps the note and its
//! template inside the workspace and never writes to a note that exists.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::grants::GrantRegistry;
use crate::workspace::paths::{from_workspace_relative, to_workspace_relative};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyNote {
    pub path: String,
    /// False when the note was already there and was left as it is.
    pub created: bool,
}

/// False when a file is already at `target`: `create_new` never replaces one,
/// so overlapping requests for the same day cannot overwrite each other.
fn write_new(target: &Path, content: &str) -> Result<bool, String> {
    match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .map(|()| true)
            .map_err(|e| format!("Failed to write the daily note: {e}")),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("Failed to create the daily note: {e}")),
    }
}

/// Ensure the note at the workspace-relative `path` exists, seeding a new one
/// from the workspace-relative `template`.
#[tauri::command]
pub fn create_daily_note(
    root: String,
    path: String,
    template: Option<String>,
    grants: State<'_, GrantRegistry>,
) -> Result<DailyNote, String> {
    let canonical_root = grants.ensure_workspace(&root)?;
    let root = Path::new(&root);
    let requested = from_workspace_relative(root, &path)?;
    let target = grants.ensure_writable(&requested.to_string_lossy())?;
    // Errors when a symlink led out of this workspace: a grant on another one
    // is not enough. Respelled as on disk, so the path equals the file tree's
    // even where the settings differ in case.
    let on_disk = to_workspace_relative(&canonical_root, &target)?;
    let path = from_workspace_relative(root, &on_disk)?
        .to_string_lossy()
        .to_string();

    if target.is_dir() {
        return Err("A folder already has the daily note's name".to_string());
    }
    // Before the template is read: an existing note opens even if its template is gone.
    if target.exists() {
        return Ok(DailyNote {
            path,
            created: false,
        });
    }

    // Read before anything is created, so a missing template leaves no empty note behind.
    let content = match template {
        Some(template) => {
            let requested = from_workspace_relative(root, &template)?;
            let source = grants.ensure_readable(&requested.to_string_lossy())?;
            to_workspace_relative(&canonical_root, &source)?;
            fs::read_to_string(&source).map_err(|e| {
                format!("Failed to read the daily note template \"{template}\": {e}")
            })?
        }
        None => String::new(),
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create the daily notes folder: {e}"))?;
    }
    let created = write_new(&target, &content)?;
    Ok(DailyNote { path, created })
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
    fn create_daily_note(
        root: &Path,
        path: &str,
        template: Option<&str>,
    ) -> Result<DailyNote, String> {
        let app = app_with_root(root);
        super::create_daily_note(
            root.to_string_lossy().to_string(),
            path.to_string(),
            template.map(str::to_string),
            app.state::<GrantRegistry>(),
        )
    }

    #[test]
    fn creates_an_empty_note_and_its_missing_folders() {
        let tmp = TempDir::new().unwrap();
        let note = create_daily_note(tmp.path(), "daily/2026/2026-10-08.md", None).unwrap();

        let expected = tmp.path().join("daily").join("2026").join("2026-10-08.md");
        assert!(note.created);
        // Spelled from the root as passed, not its canonical form.
        assert_eq!(Path::new(&note.path), expected);
        assert_eq!(fs::read_to_string(expected).unwrap(), "");
    }

    #[test]
    fn seeds_a_new_note_from_the_template() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("templates")).unwrap();
        fs::write(
            tmp.path().join("templates/daily.md"),
            "# {{date}}\n\n- [ ] ",
        )
        .unwrap();

        let note = create_daily_note(
            tmp.path(),
            "daily/2026-10-08.md",
            Some("templates/daily.md"),
        )
        .unwrap();

        assert!(note.created);
        assert_eq!(
            fs::read_to_string(tmp.path().join("daily/2026-10-08.md")).unwrap(),
            "# {{date}}\n\n- [ ] "
        );
    }

    #[test]
    fn an_existing_note_is_returned_untouched() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("templates")).unwrap();
        fs::write(tmp.path().join("templates/daily.md"), "template").unwrap();
        fs::create_dir_all(tmp.path().join("daily")).unwrap();
        let existing = tmp.path().join("daily/2026-10-08.md");
        fs::write(&existing, "what I wrote this morning").unwrap();

        let note = create_daily_note(
            tmp.path(),
            "daily/2026-10-08.md",
            Some("templates/daily.md"),
        )
        .unwrap();

        assert!(!note.created);
        assert_eq!(Path::new(&note.path), existing);
        assert_eq!(
            fs::read_to_string(&existing).unwrap(),
            "what I wrote this morning"
        );
    }

    #[test]
    fn an_existing_note_opens_even_when_its_template_is_gone() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("2026-10-08.md"), "kept").unwrap();

        let note = create_daily_note(tmp.path(), "2026-10-08.md", Some("templates/gone.md"));

        assert!(!note.unwrap().created);
        assert_eq!(
            fs::read_to_string(tmp.path().join("2026-10-08.md")).unwrap(),
            "kept"
        );
    }

    #[test]
    fn a_missing_template_fails_before_anything_is_created() {
        let tmp = TempDir::new().unwrap();

        let err = create_daily_note(tmp.path(), "daily/2026-10-08.md", Some("templates/gone.md"))
            .unwrap_err();

        assert!(err.contains("templates/gone.md"), "{err}");
        assert!(!tmp.path().join("daily").exists());
    }

    #[test]
    fn a_file_where_the_folder_should_be_is_reported() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("daily"), "not a folder").unwrap();

        let err = create_daily_note(tmp.path(), "daily/2026-10-08.md", None).unwrap_err();

        assert!(err.contains("daily notes folder"), "{err}");
        assert_eq!(
            fs::read_to_string(tmp.path().join("daily")).unwrap(),
            "not a folder"
        );
    }

    #[test]
    fn a_note_path_leaving_the_workspace_is_refused() {
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        fs::create_dir_all(&ws).unwrap();

        assert!(create_daily_note(&ws, "../escape.md", None).is_err());
        assert!(create_daily_note(&ws, "daily/../../escape.md", None).is_err());
        assert!(!outer.path().join("escape.md").exists());
    }

    #[test]
    fn the_workspace_root_is_not_a_note() {
        let tmp = TempDir::new().unwrap();
        for path in ["", "."] {
            let err = create_daily_note(tmp.path(), path, None).unwrap_err();
            assert!(err.contains("workspace root"), "{err}");
        }
    }

    // A case-insensitive filesystem resolves `daily` to an existing `Daily`;
    // reporting the request's spelling would open a second tab on a note the
    // file tree lists under the folder's real name.
    #[cfg(windows)]
    #[test]
    fn the_note_path_uses_the_folder_s_spelling_on_disk() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("Daily")).unwrap();

        let note = create_daily_note(tmp.path(), "daily/2026-10-08.md", None).unwrap();

        assert_eq!(
            Path::new(&note.path),
            tmp.path().join("Daily").join("2026-10-08.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_note_behind_a_symlinked_folder_is_reported_where_it_really_is() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("journal")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("journal"), tmp.path().join("daily")).unwrap();

        let note = create_daily_note(tmp.path(), "daily/2026-10-08.md", None).unwrap();

        assert!(note.created);
        assert_eq!(
            Path::new(&note.path),
            tmp.path().join("journal").join("2026-10-08.md")
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
    fn a_folder_with_the_note_s_name_is_refused() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("daily/2026-10-08.md")).unwrap();

        let err = create_daily_note(tmp.path(), "daily/2026-10-08.md", None).unwrap_err();

        assert!(err.contains("folder"), "{err}");
    }

    #[test]
    fn a_template_path_leaving_the_workspace_is_refused() {
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(outer.path().join("secret.md"), "secret").unwrap();

        let result = create_daily_note(&ws, "2026-10-08.md", Some("../secret.md"));

        assert!(result.is_err());
        assert!(!ws.join("2026-10-08.md").exists());
    }

    #[test]
    fn an_ungranted_workspace_is_refused() {
        let tmp = TempDir::new().unwrap();
        let app = mock_app();
        app.manage(GrantRegistry::default());

        let result = super::create_daily_note(
            tmp.path().to_string_lossy().to_string(),
            "2026-10-08.md".to_string(),
            None,
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

        let result = super::create_daily_note(
            sub.to_string_lossy().to_string(),
            "2026-10-08.md".to_string(),
            None,
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(!sub.join("2026-10-08.md").exists());
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

        assert!(create_daily_note(&ws, "daily/2026-10-08.md", None).is_err());
        assert!(!elsewhere.join("2026-10-08.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_into_another_granted_workspace_is_refused() {
        // Writable is not enough: the note belongs to this workspace.
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

        let result = super::create_daily_note(
            ws.to_string_lossy().to_string(),
            "daily/2026-10-08.md".to_string(),
            None,
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(!other.join("2026-10-08.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_template_resolving_outside_is_refused() {
        let outer = TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(outer.path().join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outer.path().join("secret.md"), ws.join("template.md")).unwrap();

        let result = create_daily_note(&ws, "2026-10-08.md", Some("template.md"));

        assert!(result.is_err());
        assert!(!ws.join("2026-10-08.md").exists());
    }
}
