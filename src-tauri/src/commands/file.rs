use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
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
/// The destination's parent must already exist (`create_dir_all`).
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

/// Where an exported site records what it wrote, so the next export into the
/// same directory knows which of its own files to remove. Site-relative, POSIX
/// style, matching the paths the exporter hands us.
const SITE_MANIFEST_REL: &str = ".glyph/site-manifest.json";

/// Resolve a manifest entry inside `out_dir`, refusing anything that could
/// escape it. The manifest lives in the output directory, so a hand-edited one
/// is untrusted input (INV-5): every segment must be a plain name, and the
/// resolved parent must still be inside the output tree after symlinks.
fn manifest_entry_path(out_dir: &Path, rel: &str) -> Option<PathBuf> {
    let mut path = out_dir.to_path_buf();
    for segment in rel.split(['/', '\\']) {
        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => path.push(name),
            _ => return None,
        }
    }
    // Delete through the canonicalized parent, not the path as joined: an
    // intermediate component swapped for a symlink between the check and the
    // unlink would otherwise escape the directory that was checked.
    let parent = path.parent()?.canonicalize().ok()?;
    let name = path.file_name()?;
    parent.starts_with(out_dir).then(|| parent.join(name))
}

/// Fold a manifest entry for comparison: separators unified, case ignored. A
/// rename that only changes case writes the same file on Windows and macOS, so
/// comparing verbatim would prune the page the current export just wrote.
fn manifest_entry_key(rel: &str) -> String {
    rel.replace('\\', "/").to_lowercase()
}

/// Remove `from` and each parent up to (but never including) `out_dir`, for as
/// long as they are empty. `remove_dir` refuses a non-empty directory, which is
/// exactly the stopping condition.
fn prune_empty_dirs(from: &Path, out_dir: &Path) {
    let mut dir = from.to_path_buf();
    while dir != out_dir && fs::remove_dir(&dir).is_ok() {
        dir.pop();
    }
}

/// Delete the files a previous website export left in `out_dir` that this one
/// did not write, then record what the output directory now holds of Glyph's.
/// Returns how many files were removed.
///
/// Pruning is against the previous export's own manifest, never against the
/// whole directory, so anything the user keeps beside the generated site (a
/// `CNAME`, a `.nojekyll`) is untouched. The manifest is trusted only to name
/// Glyph's output: every entry it claims is confined to `out_dir`, and that
/// confinement, not the manifest's contents, is the boundary.
#[tauri::command]
pub fn prune_export_dir(
    out_dir: String,
    written: Vec<String>,
    grants: State<'_, GrantRegistry>,
) -> Result<usize, String> {
    let out_dir = grants.ensure_writable(&out_dir)?;
    let manifest = out_dir.join(SITE_MANIFEST_REL);
    let previous: Vec<String> = fs::read_to_string(&manifest)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    let keep: HashSet<String> = written.iter().map(|rel| manifest_entry_key(rel)).collect();
    let mut claimed = written;
    let mut removed = 0;
    for rel in previous
        .iter()
        .filter(|rel| !keep.contains(&manifest_entry_key(rel)))
    {
        let Some(path) = manifest_entry_path(&out_dir, rel) else {
            continue;
        };
        if fs::remove_file(&path).is_ok() {
            removed += 1;
            if let Some(parent) = path.parent() {
                prune_empty_dirs(parent, &out_dir);
            }
        } else if path.exists() {
            // Read-only, locked by another process, or a directory: keep
            // claiming it so a later export prunes it. Dropping it here would
            // orphan the file in the output for good.
            claimed.push(rel.clone());
        }
    }

    if let Some(parent) = manifest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let json = serde_json::to_string(&claimed).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(&manifest, json).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(removed)
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

    fn app_with_grants() -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app
    }

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

    fn app_with_export_dir(dir: &Path) -> tauri::App<MockRuntime> {
        let app = app_with_grants();
        app.state::<GrantRegistry>().grant_export_dir(dir).unwrap();
        app
    }

    /// An output directory with a previous export's manifest already in place.
    fn out_dir_with_manifest(name: &str, previous: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glyph_test_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        fs::write(
            dir.join(SITE_MANIFEST_REL),
            serde_json::to_string(previous).unwrap(),
        )
        .unwrap();
        dir
    }

    fn prune(dir: &Path, written: &[&str]) -> Result<usize, String> {
        let app = app_with_export_dir(dir);
        prune_export_dir(
            dir.to_string_lossy().to_string(),
            written.iter().map(|s| s.to_string()).collect(),
            app.state::<GrantRegistry>(),
        )
    }

    #[test]
    fn prune_export_dir_removes_only_files_the_previous_export_wrote() {
        let dir = out_dir_with_manifest("prune_stale", &["index.html", "guide.html"]);
        fs::write(dir.join("index.html"), "home").unwrap();
        fs::write(dir.join("guide.html"), "stale").unwrap();
        // Not Glyph's file: a static host's marker the user keeps beside the site.
        fs::write(dir.join("CNAME"), "example.com").unwrap();

        let removed = prune(&dir, &["index.html"]).unwrap();

        assert_eq!(removed, 1);
        assert!(!dir.join("guide.html").exists());
        assert!(dir.join("index.html").exists());
        assert!(dir.join("CNAME").exists());
        // The manifest now describes this export, so the next one prunes against it.
        let manifest = fs::read_to_string(dir.join(SITE_MANIFEST_REL)).unwrap();
        assert_eq!(manifest, r#"["index.html"]"#);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_removes_directories_a_pruned_page_leaves_empty() {
        let dir = out_dir_with_manifest("prune_dirs", &["guide/intro.html"]);
        fs::create_dir_all(dir.join("guide")).unwrap();
        fs::write(dir.join("guide/intro.html"), "gone").unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), 1);

        assert!(!dir.join("guide").exists());
        assert!(dir.exists(), "the output directory itself is never removed");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_deletes_nothing_without_a_previous_manifest() {
        let dir =
            std::env::temp_dir().join(format!("glyph_test_prune_first_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("keep.txt"), "not ours").unwrap();

        assert_eq!(prune(&dir, &["index.html"]).unwrap(), 0);

        assert!(dir.join("keep.txt").exists());
        assert!(dir.join(SITE_MANIFEST_REL).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_ignores_a_malformed_manifest() {
        let dir = std::env::temp_dir().join(format!("glyph_test_prune_bad_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        fs::write(dir.join(SITE_MANIFEST_REL), "{ not json").unwrap();
        fs::write(dir.join("index.html"), "home").unwrap();

        assert_eq!(prune(&dir, &["index.html"]).unwrap(), 0);

        assert!(dir.join("index.html").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_refuses_manifest_entries_that_escape_the_output_directory() {
        let outer =
            std::env::temp_dir().join(format!("glyph_test_prune_escape_{}", std::process::id()));
        let _ = fs::remove_dir_all(&outer);
        let dir = outer.join("site");
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        let victim = outer.join("secret.txt");
        fs::write(&victim, "keep").unwrap();
        // A hand-edited manifest is untrusted input, whatever shape it takes.
        let escapes = vec![
            "../secret.txt".to_string(),
            "..\\secret.txt".to_string(),
            victim.to_string_lossy().to_string(),
            "./index.html".to_string(),
            "".to_string(),
        ];
        fs::write(
            dir.join(SITE_MANIFEST_REL),
            serde_json::to_string(&escapes).unwrap(),
        )
        .unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), 0);

        assert!(victim.exists());

        let _ = fs::remove_dir_all(&outer);
    }

    #[cfg(windows)]
    #[test]
    fn prune_export_dir_refuses_an_entry_reached_through_a_junction() {
        let outer =
            std::env::temp_dir().join(format!("glyph_test_prune_junc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&outer);
        let dir = outer.join("site");
        let elsewhere = outer.join("elsewhere");
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        let victim = elsewhere.join("secret.txt");
        fs::write(&victim, "keep").unwrap();
        // Junctions are the Windows escape vector symlinks are on unix, and
        // unlike symlinks they need no privilege to create.
        let output = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(dir.join("out"))
            .arg(&elsewhere)
            .output()
            .expect("cmd should run");
        assert!(output.status.success(), "mklink /J failed");
        fs::write(
            dir.join(SITE_MANIFEST_REL),
            serde_json::to_string(&["out/secret.txt"]).unwrap(),
        )
        .unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), 0);

        assert!(victim.exists());

        let _ = fs::remove_dir_all(&outer);
    }

    #[test]
    fn prune_export_dir_keeps_the_page_a_case_only_rename_rewrote() {
        // Windows and macOS write `Guide.html` and `guide.html` to one file,
        // so pruning the old spelling would delete the page just written.
        let dir = out_dir_with_manifest("prune_case", &["Guide.html"]);
        fs::write(dir.join("guide.html"), "the current page").unwrap();

        assert_eq!(prune(&dir, &["guide.html"]).unwrap(), 0);

        assert_eq!(
            fs::read_to_string(dir.join("guide.html")).unwrap(),
            "the current page"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_keeps_claiming_a_file_it_could_not_remove() {
        // A directory stands in for the read-only or locked file the removal
        // fails on: dropping the claim would orphan it in the output for good.
        let dir = out_dir_with_manifest("prune_stuck", &["stuck"]);
        fs::create_dir_all(dir.join("stuck")).unwrap();
        fs::write(dir.join("stuck/inside.txt"), "blocks the removal").unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), 0);

        assert!(dir.join("stuck").exists());
        let manifest = fs::read_to_string(dir.join(SITE_MANIFEST_REL)).unwrap();
        assert_eq!(manifest, r#"["stuck"]"#);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_hands_its_manifest_to_the_next_export() {
        let dir =
            std::env::temp_dir().join(format!("glyph_test_prune_chain_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "home").unwrap();
        fs::write(dir.join("guide.html"), "guide").unwrap();

        assert_eq!(prune(&dir, &["index.html", "guide.html"]).unwrap(), 0);
        // Second export: guide.md is gone, so its page is no longer written.
        assert_eq!(prune(&dir, &["index.html"]).unwrap(), 1);

        assert!(!dir.join("guide.html").exists());
        assert!(dir.join("index.html").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn prune_export_dir_refuses_an_entry_reached_through_a_symlinked_directory() {
        let outer =
            std::env::temp_dir().join(format!("glyph_test_prune_link_{}", std::process::id()));
        let _ = fs::remove_dir_all(&outer);
        let dir = outer.join("site");
        let elsewhere = outer.join("elsewhere");
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        let victim = elsewhere.join("secret.txt");
        fs::write(&victim, "keep").unwrap();
        std::os::unix::fs::symlink(&elsewhere, dir.join("out")).unwrap();
        fs::write(
            dir.join(SITE_MANIFEST_REL),
            serde_json::to_string(&["out/secret.txt"]).unwrap(),
        )
        .unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), 0);

        assert!(victim.exists());

        let _ = fs::remove_dir_all(&outer);
    }

    #[test]
    fn prune_export_dir_denied_without_a_grant() {
        let dir =
            std::env::temp_dir().join(format!("glyph_test_prune_denied_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".glyph")).unwrap();
        fs::write(dir.join(SITE_MANIFEST_REL), r#"["index.html"]"#).unwrap();
        fs::write(dir.join("index.html"), "home").unwrap();

        let app = app_with_grants();
        let result = prune_export_dir(
            dir.to_string_lossy().to_string(),
            vec![],
            app.state::<GrantRegistry>(),
        );

        assert!(result.is_err());
        assert!(dir.join("index.html").exists());

        let _ = fs::remove_dir_all(&dir);
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
