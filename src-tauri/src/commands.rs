use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

pub struct InitialFile(pub Mutex<Option<String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: u64,
}

#[tauri::command]
pub fn get_initial_file(state: State<'_, InitialFile>) -> Option<String> {
    state.0.lock().ok()?.clone()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
pub fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("Failed to print: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
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
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    let metadata = fs::metadata(p).map_err(|e| format!("Failed to get metadata: {e}"))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {e}"))?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(FileMetadata {
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: p
            .canonicalize()
            .unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy()
            .to_string(),
        size: metadata.len(),
        modified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn read_file_success() {
        let dir = std::env::temp_dir().join("glyph_test_read");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"# Hello\nWorld").unwrap();

        let result = read_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Hello\nWorld");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_not_found() {
        let result = read_file("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read file"));
    }

    #[test]
    fn read_file_empty() {
        let dir = std::env::temp_dir().join("glyph_test_read_empty");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("empty.md");
        fs::File::create(&file_path).unwrap();

        let result = read_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_utf8_content() {
        let dir = std::env::temp_dir().join("glyph_test_utf8");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("utf8.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all("# 你好世界\nHello 🌍".as_bytes()).unwrap();

        let result = read_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().contains("你好世界"));

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn get_metadata_success() {
        let dir = std::env::temp_dir().join("glyph_test_meta");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("meta_test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"content").unwrap();

        let result = get_file_metadata(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());

        let metadata = result.unwrap();
        assert_eq!(metadata.name, "meta_test.md");
        assert_eq!(metadata.size, 7);
        assert!(metadata.modified > 0);
        assert!(!metadata.path.is_empty());

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn get_metadata_not_found() {
        let result = get_file_metadata("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get metadata"));
    }

    #[test]
    fn metadata_serialization() {
        let metadata = FileMetadata {
            name: "test.md".to_string(),
            path: "/path/to/test.md".to_string(),
            size: 42,
            modified: 1700000000,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"name\":\"test.md\""));
        assert!(json.contains("\"path\":\"/path/to/test.md\""));
        assert!(json.contains("\"size\":42"));
        assert!(json.contains("\"modified\":1700000000"));
    }

    #[test]
    fn metadata_camel_case_keys() {
        let metadata = FileMetadata {
            name: "test.md".to_string(),
            path: "/test.md".to_string(),
            size: 0,
            modified: 0,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(!json.contains("file_name"));
        assert!(json.contains("name"));
    }

    #[test]
    fn initial_file_default_is_none() {
        let initial = InitialFile(Mutex::new(None));
        let guard = initial.0.lock().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn initial_file_with_value() {
        let initial = InitialFile(Mutex::new(Some("/path/to/file.md".to_string())));
        let guard = initial.0.lock().unwrap();
        assert_eq!(guard.as_deref(), Some("/path/to/file.md"));
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
