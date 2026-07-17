use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

use super::walk::{workspace_walker, ScanStatus, WALK_MAX_DEPTH, WALK_MAX_FILES};
use crate::grants::GrantRegistry;

pub struct InitialFolder(pub Mutex<Option<String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: u64,
}

/// Return the folder the app was launched to open, if any, consuming it. See
/// [`super::file::get_initial_file`] for why this takes rather than clones.
#[tauri::command]
pub fn get_initial_folder(state: State<'_, InitialFolder>) -> Option<String> {
    state.0.lock().ok()?.take()
}

#[tauri::command]
pub fn read_directory(
    path: String,
    grants: State<'_, GrantRegistry>,
) -> Result<Vec<DirEntry>, String> {
    // Validate, then walk the path as given: a canonical `\\?\` prefix on
    // Windows would break workspace-containment string checks in the UI.
    grants.ensure_readable(&path)?;
    let dir = Path::new(&path);
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_directory = metadata.is_dir();
        // The sidebar lists openable documents plus image/SVG assets. Images are
        // not part of `is_supported_file` (the document index that feeds the
        // graph / wikilinks), so they are admitted here on top of it.
        if !is_directory
            && !crate::is_supported_file(&entry_path)
            && !crate::is_image_file(&entry_path)
        {
            continue;
        }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(DirEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
            modified,
        });
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileScan {
    pub files: Vec<String>,
    pub status: ScanStatus,
}

#[tauri::command]
pub fn list_markdown_files(
    path: String,
    grants: State<'_, GrantRegistry>,
) -> Result<FileScan, String> {
    grants.ensure_readable(&path)?;
    list_markdown_files_capped(&path, WALK_MAX_FILES, WALK_MAX_DEPTH)
}

/// Body of [`list_markdown_files`] with the caps as parameters, so the
/// truncation branches are testable without creating `WALK_MAX_FILES` real
/// files or a `WALK_MAX_DEPTH`-deep tree.
fn list_markdown_files_capped(
    path: &str,
    max_files: usize,
    max_depth: usize,
) -> Result<FileScan, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut files: Vec<String> = Vec::new();
    let mut status = ScanStatus::complete();
    for entry in workspace_walker(root, max_depth) {
        if entry.file_type().is_dir() {
            // A directory yielded at the depth cap is not descended into, so
            // anything below it is missing from the index.
            if entry.depth() >= max_depth {
                status = ScanStatus::depth_limit(max_depth);
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !crate::is_supported_file(p) {
            continue;
        }
        if files.len() >= max_files {
            status = ScanStatus::file_limit(max_files);
            break;
        }
        files.push(p.to_string_lossy().to_string());
    }

    Ok(FileScan { files, status })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;

    fn app_with_workspace(dir: &Path) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
        app
    }

    fn unique_tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_test_{}_{}_{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn read_directory_lists_documents_images_and_dirs() {
        let dir = unique_tmp("read_dir_basic");
        fs::write(dir.join("readme.md"), "x").unwrap();
        fs::write(dir.join("notes.markdown"), "x").unwrap();
        fs::write(dir.join("diagram.svg"), b"<svg/>").unwrap();
        fs::write(dir.join("photo.png"), b"x").unwrap();
        fs::write(dir.join("architecture.d2"), b"a -> b").unwrap();
        fs::write(dir.join("data.json"), b"x").unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();

        let app = app_with_workspace(&dir);
        let result = read_directory(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"subdir"));
        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&"notes.markdown"));
        assert!(names.contains(&"diagram.svg"), "svg files are listed");
        assert!(names.contains(&"photo.png"), "image files are listed");
        assert!(names.contains(&"architecture.d2"), "d2 files are listed");
        assert!(
            !names.contains(&"data.json"),
            "unsupported files filtered out"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_skips_hidden_entries() {
        let dir = unique_tmp("read_dir_hidden");
        fs::write(dir.join("visible.md"), "x").unwrap();
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();

        let app = app_with_workspace(&dir);
        let result = read_directory(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(names, vec!["visible.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_sorts_dirs_first_then_alpha() {
        let dir = unique_tmp("read_dir_sort");
        fs::write(dir.join("zeta.md"), "x").unwrap();
        fs::write(dir.join("alpha.md"), "x").unwrap();
        fs::create_dir_all(dir.join("beta")).unwrap();
        fs::create_dir_all(dir.join("Apple")).unwrap();

        let app = app_with_workspace(&dir);
        let result = read_directory(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        let order: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(order, vec!["Apple", "beta", "alpha.md", "zeta.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_empty_dir_returns_empty() {
        let dir = unique_tmp("read_dir_empty");
        let app = app_with_workspace(&dir);
        let result = read_directory(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        assert!(result.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_not_found_returns_err() {
        // Granted but since-deleted: hits the fs error, not the grant gate.
        let dir = unique_tmp("read_dir_missing");
        let app = app_with_workspace(&dir);
        let missing = dir.join("gone");
        let result = read_directory(
            missing.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read directory"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_denied_without_a_grant() {
        let dir = unique_tmp("read_dir_denied");
        fs::write(dir.join("readme.md"), "x").unwrap();

        let app = mock_app();
        app.manage(GrantRegistry::default());
        let result = read_directory(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        let err = result.expect_err("must be denied");
        assert!(err.starts_with("path is outside the allowed workspaces and files:"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_denied_without_a_grant() {
        let dir = unique_tmp("list_md_denied");
        fs::write(dir.join("keep.md"), "x").unwrap();

        let app = mock_app();
        app.manage(GrantRegistry::default());
        let result = list_markdown_files(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_walks_recursively() {
        let dir = unique_tmp("list_md_recursive");
        fs::write(dir.join("root.md"), "x").unwrap();
        fs::create_dir_all(dir.join("nested/deep")).unwrap();
        fs::write(dir.join("nested/a.md"), "x").unwrap();
        fs::write(dir.join("nested/deep/b.markdown"), "x").unwrap();
        fs::write(dir.join("nested/image.png"), b"x").unwrap();

        let app = app_with_workspace(&dir);
        let scan = list_markdown_files(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(scan.status, ScanStatus::complete());
        let mut result = scan.files;
        result.sort();
        let names: Vec<String> = result
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert!(names.contains(&"root.md".to_string()));
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"b.markdown".to_string()));
        assert!(!names.iter().any(|n| n == "image.png"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_skips_hidden_and_noisy_dirs() {
        let dir = unique_tmp("list_md_skip");
        fs::write(dir.join("keep.md"), "x").unwrap();
        for skip in &[".git", "node_modules", "target", ".svn", ".hg"] {
            fs::create_dir_all(dir.join(skip)).unwrap();
            fs::write(dir.join(skip).join("ignored.md"), "x").unwrap();
        }
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/ignored.md"), "x").unwrap();

        let app = app_with_workspace(&dir);
        let result = list_markdown_files(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .unwrap()
        .files;
        let names: Vec<String> = result
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names, vec!["keep.md".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_truncates_at_the_file_cap() {
        let dir = unique_tmp("list_md_cap");
        for i in 0..3 {
            fs::write(dir.join(format!("f{i}.md")), "x").unwrap();
        }

        let scan = list_markdown_files_capped(&dir.to_string_lossy(), 2, WALK_MAX_DEPTH).unwrap();
        assert_eq!(scan.files.len(), 2);
        assert_eq!(scan.status, ScanStatus::file_limit(2));
        // Sorted traversal makes the covered subset deterministic.
        assert!(scan.files[0].ends_with("f0.md"));
        assert!(scan.files[1].ends_with("f1.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_reports_the_depth_cap() {
        let dir = unique_tmp("list_md_depth");
        fs::write(dir.join("top.md"), "x").unwrap();
        fs::create_dir_all(dir.join("nested/deep")).unwrap();
        fs::write(dir.join("nested/deep/hidden.md"), "x").unwrap();

        let scan = list_markdown_files_capped(&dir.to_string_lossy(), WALK_MAX_FILES, 1).unwrap();
        let names: Vec<&str> = scan
            .files
            .iter()
            .filter_map(|p| Path::new(p).file_name())
            .filter_map(|n| n.to_str())
            .collect();
        assert_eq!(names, vec!["top.md"]);
        assert_eq!(scan.status, ScanStatus::depth_limit(1));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_complete_scan_reports_no_truncation() {
        let dir = unique_tmp("list_md_complete");
        fs::write(dir.join("a.md"), "x").unwrap();
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("nested/b.md"), "x").unwrap();

        let scan =
            list_markdown_files_capped(&dir.to_string_lossy(), WALK_MAX_FILES, WALK_MAX_DEPTH)
                .unwrap();
        assert_eq!(scan.files.len(), 2);
        assert_eq!(scan.status, ScanStatus::complete());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_errors_on_non_directory() {
        let dir = unique_tmp("list_md_not_dir");
        let file = dir.join("file.md");
        fs::write(&file, "x").unwrap();

        let app = app_with_workspace(&dir);
        let result = list_markdown_files(
            file.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn initial_folder_default_is_none() {
        let initial = InitialFolder(Mutex::new(None));
        let guard = initial.0.lock().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn initial_folder_with_value() {
        let initial = InitialFolder(Mutex::new(Some("/path/to/folder".to_string())));
        let guard = initial.0.lock().unwrap();
        assert_eq!(guard.as_deref(), Some("/path/to/folder"));
    }

    #[test]
    fn get_initial_folder_returns_managed_value() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(InitialFolder(Mutex::new(Some("/ws/folder".to_string()))));
        let result = get_initial_folder(app.state::<InitialFolder>());
        assert_eq!(result.as_deref(), Some("/ws/folder"));
    }

    #[test]
    fn get_initial_folder_returns_none_when_unset() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(InitialFolder(Mutex::new(None)));
        let result = get_initial_folder(app.state::<InitialFolder>());
        assert!(result.is_none());
    }

    #[test]
    fn dir_entry_camel_case_keys() {
        let entry = DirEntry {
            name: "file.md".to_string(),
            path: "/p/file.md".to_string(),
            is_directory: false,
            modified: 1,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"isDirectory\":false"));
        assert!(!json.contains("is_directory"));
    }
}
