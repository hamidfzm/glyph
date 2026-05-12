use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

use super::walk::{WALK_MAX_DEPTH, WALK_MAX_FILES, WALK_SKIP_DIRS};

pub struct InitialFolder(pub Mutex<Option<String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: u64,
}

#[tauri::command]
pub fn get_initial_folder(state: State<'_, InitialFolder>) -> Option<String> {
    state.0.lock().ok()?.clone()
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<DirEntry>, String> {
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
        if !is_directory && !crate::is_markdown_file(&entry_path) {
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

#[tauri::command]
pub fn list_markdown_files(path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let walker = WalkDir::new(root)
        .max_depth(WALK_MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip hidden entries and known noisy directories
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') && e.depth() > 0 {
                return false;
            }
            if e.file_type().is_dir() && WALK_SKIP_DIRS.contains(&name.as_ref()) {
                return false;
            }
            true
        });

    let mut results: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !crate::is_markdown_file(p) {
            continue;
        }
        if results.len() >= WALK_MAX_FILES {
            truncated = true;
            break;
        }
        results.push(p.to_string_lossy().to_string());
    }

    if truncated {
        eprintln!(
            "list_markdown_files: workspace at {} exceeds {} files; results truncated",
            path, WALK_MAX_FILES
        );
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn read_directory_lists_md_files_and_dirs() {
        let dir = unique_tmp("read_dir_basic");
        fs::write(dir.join("readme.md"), "x").unwrap();
        fs::write(dir.join("notes.markdown"), "x").unwrap();
        fs::write(dir.join("image.png"), b"x").unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"subdir"));
        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&"notes.markdown"));
        assert!(!names.contains(&"image.png"), "non-markdown files filtered out");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_skips_hidden_entries() {
        let dir = unique_tmp("read_dir_hidden");
        fs::write(dir.join("visible.md"), "x").unwrap();
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
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

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        let order: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(order, vec!["Apple", "beta", "alpha.md", "zeta.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_empty_dir_returns_empty() {
        let dir = unique_tmp("read_dir_empty");
        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_not_found_returns_err() {
        let result = read_directory("/nonexistent/glyph/path/abc123".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read directory"));
    }

    #[test]
    fn list_markdown_files_walks_recursively() {
        let dir = unique_tmp("list_md_recursive");
        fs::write(dir.join("root.md"), "x").unwrap();
        fs::create_dir_all(dir.join("nested/deep")).unwrap();
        fs::write(dir.join("nested/a.md"), "x").unwrap();
        fs::write(dir.join("nested/deep/b.markdown"), "x").unwrap();
        fs::write(dir.join("nested/image.png"), b"x").unwrap();

        let mut result = list_markdown_files(dir.to_string_lossy().to_string()).unwrap();
        result.sort();
        let names: Vec<String> = result
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
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

        let result = list_markdown_files(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<String> = result
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["keep.md".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_errors_on_non_directory() {
        let dir = unique_tmp("list_md_not_dir");
        let file = dir.join("file.md");
        fs::write(&file, "x").unwrap();

        let result = list_markdown_files(file.to_string_lossy().to_string());
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
