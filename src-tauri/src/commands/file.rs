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

/// Return the file the app was launched to open, if any, consuming it. `take`
/// (not `clone`) matters now that macOS `RunEvent::Opened` can write this stash
/// at any point in the app's life, not just at startup: consuming on first read
/// means a later launch's path can never resurface in a subsequently-opened
/// window (or a dev hot-reload) as a stale file.
#[tauri::command]
pub fn get_initial_file(state: State<'_, InitialFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

// `WebviewWindow::print` doesn't exist on mobile; the command is registered
// only on desktop (cfg-gated in lib.rs's generate_handler list) and the
// frontend hides the print entry points there.
#[cfg(desktop)]
#[tauri::command]
pub fn print_document<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String> {
    window.print().map_err(|e| format!("Failed to print: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
}

/// Write raw bytes to disk. Used by the export feature for binary formats
/// (DOCX, EPUB) that the frontend builds in-memory; `write_file` only handles
/// UTF-8 text.
#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &contents).map_err(|e| format!("Failed to write file: {e}"))
}

/// Create a directory and all missing parents. Used by the website exporter,
/// which mirrors the workspace's folder tree into the output directory.
#[tauri::command]
pub fn create_dir_all(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {e}"))
}

/// Copy a file byte-for-byte, e.g. an image referenced by an exported page.
/// The destination's parent must already exist (`create_dir_all`).
#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(&src, &dest)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy file: {e}"))
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
    fn write_binary_file_round_trips_bytes() {
        let dir = std::env::temp_dir().join("glyph_test_write_binary");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("out.bin");
        let bytes = vec![0u8, 1, 2, 255, 254, 0, 42];

        let result = write_binary_file(file_path.to_string_lossy().to_string(), bytes.clone());
        assert!(result.is_ok());
        assert_eq!(fs::read(&file_path).unwrap(), bytes);

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_binary_file_bad_path_errors() {
        let result = write_binary_file("/nonexistent/dir/out.bin".to_string(), vec![1, 2, 3]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to write file"));
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
    fn get_initial_file_returns_managed_value() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(InitialFile(Mutex::new(Some("/ws/file.md".to_string()))));
        let result = get_initial_file(app.state::<InitialFile>());
        assert_eq!(result.as_deref(), Some("/ws/file.md"));
    }

    #[test]
    fn get_initial_file_returns_none_when_unset() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(InitialFile(Mutex::new(None)));
        let result = get_initial_file(app.state::<InitialFile>());
        assert!(result.is_none());
    }

    #[test]
    fn get_initial_file_is_consumed_on_read() {
        use tauri::test::mock_app;
        use tauri::Manager;

        // The stash is read-once: a macOS `RunEvent::Opened` may have written a
        // launch path, and once the primary window reads it, no later window (or
        // dev hot-reload) should resurface it.
        let app = mock_app();
        app.manage(InitialFile(Mutex::new(Some("/ws/file.md".to_string()))));
        assert_eq!(
            get_initial_file(app.state::<InitialFile>()).as_deref(),
            Some("/ws/file.md")
        );
        assert!(get_initial_file(app.state::<InitialFile>()).is_none());
    }

    #[test]
    fn write_file_round_trips_text() {
        let dir = std::env::temp_dir().join("glyph_test_write_text");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("out.md");

        let result = write_file(
            file_path.to_string_lossy().to_string(),
            "# Saved\n".to_string(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "# Saved\n");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_file_bad_path_errors() {
        let result = write_file("/nonexistent/dir/out.md".to_string(), "x".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to write file"));
    }

    #[test]
    fn print_document_succeeds_on_a_mock_window() {
        use tauri::test::mock_app;
        use tauri::WebviewWindowBuilder;

        let app = mock_app();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock window should build");
        assert!(print_document(window).is_ok());
    }

    #[test]
    fn create_dir_all_creates_nested_directories() {
        let root = std::env::temp_dir().join(format!("glyph_test_mkdir_{}", std::process::id()));
        let nested = root.join("a").join("b").join("c");

        let result = create_dir_all(nested.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(nested.is_dir());
        // Idempotent: creating an existing tree is fine.
        assert!(create_dir_all(nested.to_string_lossy().to_string()).is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_dir_all_bad_path_errors() {
        // A path whose parent is a *file* cannot become a directory.
        let root =
            std::env::temp_dir().join(format!("glyph_test_mkdir_bad_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let blocker = root.join("file.txt");
        fs::write(&blocker, "x").unwrap();

        let result = create_dir_all(blocker.join("sub").to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to create directory"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_round_trips_bytes() {
        let root = std::env::temp_dir().join(format!("glyph_test_copy_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let src = root.join("src.png");
        let dest = root.join("dest.png");
        fs::write(&src, [0x89u8, 0x50, 0x4e, 0x47]).unwrap();

        let result = copy_file(
            src.to_string_lossy().to_string(),
            dest.to_string_lossy().to_string(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read(&dest).unwrap(), vec![0x89u8, 0x50, 0x4e, 0x47]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_missing_source_errors() {
        let root =
            std::env::temp_dir().join(format!("glyph_test_copy_miss_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);

        let result = copy_file(
            root.join("nope.png").to_string_lossy().to_string(),
            root.join("dest.png").to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to copy file"));

        let _ = fs::remove_dir_all(&root);
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
}
