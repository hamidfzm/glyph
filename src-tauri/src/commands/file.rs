use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

use crate::grants::GrantRegistry;

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
pub fn read_file(path: String, grants: State<'_, GrantRegistry>) -> Result<String, String> {
    let path = grants.ensure_readable(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[cfg(desktop)]
#[tauri::command]
pub fn print_document<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String> {
    window.print().map_err(|e| format!("Failed to print: {e}"))
}

#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    let path = grants.ensure_writable(&path)?;
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
}

/// Write raw bytes to disk. Used by the export feature for binary formats
/// (DOCX, EPUB) that the frontend builds in-memory; `write_file` only handles
/// UTF-8 text.
#[tauri::command]
pub fn write_binary_file(
    path: String,
    contents: Vec<u8>,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    let path = grants.ensure_writable(&path)?;
    fs::write(&path, &contents).map_err(|e| format!("Failed to write file: {e}"))
}

/// Create a directory and all missing parents. Used by the website exporter,
/// which mirrors the workspace's folder tree into the output directory.
#[tauri::command]
pub fn create_dir_all(path: String, grants: State<'_, GrantRegistry>) -> Result<(), String> {
    let path = grants.ensure_writable(&path)?;
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {e}"))
}

/// Copy a file byte-for-byte, e.g. an image referenced by an exported page.
/// The destination's parent must already exist (`create_dir_all`). The source
/// must be readable and the destination writable.
#[tauri::command]
pub fn copy_file(
    src: String,
    dest: String,
    grants: State<'_, GrantRegistry>,
) -> Result<(), String> {
    let src = grants.ensure_readable(&src)?;
    let dest = grants.ensure_writable(&dest)?;
    fs::copy(&src, &dest)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy file: {e}"))
}

#[tauri::command]
pub fn get_file_metadata(
    path: String,
    grants: State<'_, GrantRegistry>,
) -> Result<FileMetadata, String> {
    let canonical = grants.ensure_readable(&path)?;
    let p = Path::new(&path);
    let metadata = fs::metadata(&canonical).map_err(|e| format!("Failed to get metadata: {e}"))?;
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
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;

    /// Mock app with an empty grant registry managed, so command signatures
    /// taking `State<'_, GrantRegistry>` can be exercised directly.
    fn app_with_grants() -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app
    }

    /// Mock app whose registry has `dir` granted as a workspace.
    fn app_with_workspace(dir: &Path) -> tauri::App<MockRuntime> {
        let app = app_with_grants();
        app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
        app
    }

    #[test]
    fn read_file_success() {
        let dir = std::env::temp_dir().join("glyph_test_read");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"# Hello\nWorld").unwrap();

        let app = app_with_workspace(&dir);
        let result = read_file(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Hello\nWorld");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_not_found() {
        let dir = std::env::temp_dir().join("glyph_test_read_missing");
        let _ = fs::create_dir_all(&dir);
        let app = app_with_workspace(&dir);
        let result = read_file(
            dir.join("nope.md").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read file"));
    }

    #[test]
    fn read_file_denied_without_a_grant() {
        let dir = std::env::temp_dir().join("glyph_test_read_denied");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("secret.md");
        fs::write(&file_path, "top secret").unwrap();

        let app = app_with_grants();
        let result = read_file(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        let err = result.expect_err("must be denied");
        assert!(
            err.starts_with("path is outside the allowed workspaces and files:"),
            "got: {err}"
        );

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_traversal_out_of_the_workspace_is_denied() {
        let outer = std::env::temp_dir().join(format!("glyph_test_trav_{}", std::process::id()));
        let root = outer.join("ws");
        let _ = fs::create_dir_all(&root);
        fs::write(outer.join("secret.md"), "x").unwrap();

        let app = app_with_workspace(&root);
        let sneaky = root.join("..").join("secret.md");
        let result = read_file(
            sneaky.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&outer);
    }

    #[test]
    fn read_file_empty() {
        let dir = std::env::temp_dir().join("glyph_test_read_empty");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("empty.md");
        fs::File::create(&file_path).unwrap();

        let app = app_with_workspace(&dir);
        let result = read_file(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
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

        let app = app_with_workspace(&dir);
        let result = read_file(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert!(result.unwrap().contains("你好世界"));

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_allows_a_granted_loose_file() {
        let dir = std::env::temp_dir().join("glyph_test_read_loose");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("loose.md");
        fs::write(&file_path, "# loose").unwrap();

        let app = app_with_grants();
        app.state::<GrantRegistry>().grant_file(&file_path).unwrap();
        let result = read_file(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert_eq!(result.unwrap(), "# loose");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_binary_file_round_trips_bytes() {
        let dir = std::env::temp_dir().join("glyph_test_write_binary");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("out.bin");
        let bytes = vec![0u8, 1, 2, 255, 254, 0, 42];

        let app = app_with_workspace(&dir);
        let result = write_binary_file(
            file_path.to_string_lossy().to_string(),
            bytes.clone(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read(&file_path).unwrap(), bytes);

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_binary_file_denied_without_a_grant() {
        let dir = std::env::temp_dir().join("glyph_test_write_binary_denied");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("out.bin");

        let app = app_with_grants();
        let result = write_binary_file(
            file_path.to_string_lossy().to_string(),
            vec![1, 2, 3],
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(!file_path.exists(), "denied write must not create the file");
    }

    #[test]
    fn write_binary_file_allows_a_granted_export_file() {
        let dir = std::env::temp_dir().join("glyph_test_write_binary_export");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("doc.docx");
        let sibling = dir.join("other.docx");

        let app = app_with_grants();
        app.state::<GrantRegistry>()
            .grant_export_file(&target)
            .unwrap();
        assert!(write_binary_file(
            target.to_string_lossy().to_string(),
            vec![9],
            app.state::<GrantRegistry>(),
        )
        .is_ok());
        assert!(write_binary_file(
            sibling.to_string_lossy().to_string(),
            vec![9],
            app.state::<GrantRegistry>(),
        )
        .is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_metadata_success() {
        let dir = std::env::temp_dir().join("glyph_test_meta");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("meta_test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"content").unwrap();

        let app = app_with_workspace(&dir);
        let result = get_file_metadata(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
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
        let dir = std::env::temp_dir().join("glyph_test_meta_missing");
        let _ = fs::create_dir_all(&dir);
        let app = app_with_workspace(&dir);
        let result = get_file_metadata(
            dir.join("nope.md").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get metadata"));
    }

    #[test]
    fn get_metadata_denied_without_a_grant() {
        let dir = std::env::temp_dir().join("glyph_test_meta_denied");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("meta.md");
        fs::write(&file_path, "x").unwrap();

        let app = app_with_grants();
        let result = get_file_metadata(
            file_path.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_file(&file_path);
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
        let app = mock_app();
        app.manage(InitialFile(Mutex::new(Some("/ws/file.md".to_string()))));
        let result = get_initial_file(app.state::<InitialFile>());
        assert_eq!(result.as_deref(), Some("/ws/file.md"));
    }

    #[test]
    fn get_initial_file_returns_none_when_unset() {
        let app = mock_app();
        app.manage(InitialFile(Mutex::new(None)));
        let result = get_initial_file(app.state::<InitialFile>());
        assert!(result.is_none());
    }

    #[test]
    fn get_initial_file_is_consumed_on_read() {
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

        let app = app_with_workspace(&dir);
        let result = write_file(
            file_path.to_string_lossy().to_string(),
            "# Saved\n".to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "# Saved\n");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_file_denied_without_a_grant() {
        let dir = std::env::temp_dir().join("glyph_test_write_denied");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("out.md");

        let app = app_with_grants();
        let result = write_file(
            file_path.to_string_lossy().to_string(),
            "x".to_string(),
            app.state::<GrantRegistry>(),
        );
        let err = result.expect_err("must be denied");
        assert!(err.starts_with("path is outside the allowed workspaces and files:"));
        assert!(!file_path.exists());
    }

    #[test]
    fn write_file_allows_autosave_of_a_granted_loose_file() {
        let dir = std::env::temp_dir().join("glyph_test_write_loose");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("loose.md");
        fs::write(&file_path, "before").unwrap();

        let app = app_with_grants();
        app.state::<GrantRegistry>().grant_file(&file_path).unwrap();
        assert!(write_file(
            file_path.to_string_lossy().to_string(),
            "after".to_string(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "after");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn write_file_bad_path_errors() {
        // Granted but unwritable (parent directory missing): the fs error path.
        let dir = std::env::temp_dir().join("glyph_test_write_bad");
        let _ = fs::create_dir_all(&dir);
        let app = app_with_workspace(&dir);
        let result = write_file(
            dir.join("missing")
                .join("out.md")
                .to_string_lossy()
                .to_string(),
            "x".to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to write file"));
    }

    #[test]
    fn print_document_succeeds_on_a_mock_window() {
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
        let _ = fs::create_dir_all(&root);
        let nested = root.join("a").join("b").join("c");

        let app = app_with_grants();
        app.state::<GrantRegistry>()
            .grant_export_dir(&root)
            .unwrap();
        let result = create_dir_all(
            nested.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert!(nested.is_dir());
        // Idempotent: creating an existing tree is fine.
        assert!(create_dir_all(
            nested.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        )
        .is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_dir_all_denied_without_a_grant() {
        let root =
            std::env::temp_dir().join(format!("glyph_test_mkdir_denied_{}", std::process::id()));
        let nested = root.join("a").join("b");

        let app = app_with_grants();
        let result = create_dir_all(
            nested.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(!nested.exists());
    }

    #[test]
    fn create_dir_all_bad_path_errors() {
        // A path whose parent is a *file* cannot become a directory.
        let root =
            std::env::temp_dir().join(format!("glyph_test_mkdir_bad_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let blocker = root.join("file.txt");
        fs::write(&blocker, "x").unwrap();

        let app = app_with_workspace(&root);
        let result = create_dir_all(
            blocker.join("sub").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_round_trips_bytes() {
        let root = std::env::temp_dir().join(format!("glyph_test_copy_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let src = root.join("src.png");
        let dest = root.join("dest.png");
        fs::write(&src, [0x89u8, 0x50, 0x4e, 0x47]).unwrap();

        let app = app_with_workspace(&root);
        let result = copy_file(
            src.to_string_lossy().to_string(),
            dest.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read(&dest).unwrap(), vec![0x89u8, 0x50, 0x4e, 0x47]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_denied_when_source_is_not_granted() {
        // Granted destination + ungranted source must fail on the source.
        let root =
            std::env::temp_dir().join(format!("glyph_test_copy_nosrc_{}", std::process::id()));
        let src_dir = root.join("outside");
        let out_dir = root.join("out");
        let _ = fs::create_dir_all(&src_dir);
        let _ = fs::create_dir_all(&out_dir);
        let src = src_dir.join("img.png");
        fs::write(&src, [1u8]).unwrap();

        let app = app_with_grants();
        app.state::<GrantRegistry>()
            .grant_export_dir(&out_dir)
            .unwrap();
        let result = copy_file(
            src.to_string_lossy().to_string(),
            out_dir.join("img.png").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_denied_when_destination_is_not_granted() {
        // Granted (readable) source + ungranted destination must fail on the
        // destination.
        let root =
            std::env::temp_dir().join(format!("glyph_test_copy_nodest_{}", std::process::id()));
        let ws = root.join("ws");
        let elsewhere = root.join("elsewhere");
        let _ = fs::create_dir_all(&ws);
        let _ = fs::create_dir_all(&elsewhere);
        let src = ws.join("img.png");
        fs::write(&src, [1u8]).unwrap();

        let app = app_with_workspace(&ws);
        let result = copy_file(
            src.to_string_lossy().to_string(),
            elsewhere.join("img.png").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        assert!(!elsewhere.join("img.png").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_file_missing_source_errors() {
        let root =
            std::env::temp_dir().join(format!("glyph_test_copy_miss_{}", std::process::id()));
        let _ = fs::create_dir_all(&root);

        let app = app_with_workspace(&root);
        let result = copy_file(
            root.join("nope.png").to_string_lossy().to_string(),
            root.join("dest.png").to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
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
