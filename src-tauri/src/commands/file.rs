use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::grants::{self, is_symlink, GrantRegistry};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[tauri::command]
pub fn read_file(path: String, grants: State<'_, GrantRegistry>) -> Result<String, String> {
    let path = grants.ensure_readable(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Let the asset protocol serve an image, audio, or video file beside an opened
/// loose file. Tauri's scope matches escaped paths only, so the registry's
/// extension rule is applied here, one file at a time.
#[tauri::command]
pub fn allow_document_asset<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let canonical = app.state::<GrantRegistry>().ensure_document_asset(&path)?;
    grants::allow_asset_file(&app, &canonical);
    Ok(())
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

/// Whether a failed lookup says nothing is there, as opposed to not being able
/// to tell. A name the volume cannot hold and a path that runs through a file
/// are as absent as a missing one; "no permission" says nothing either way.
fn says_absent(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::NotFound
            | ErrorKind::NotADirectory
            | ErrorKind::InvalidFilename
            | ErrorKind::InvalidInput
    )
}

/// Resolve a manifest entry inside `out_dir`, refusing anything that could
/// escape it. The manifest lives in the output directory, so a hand-edited one
/// is untrusted input (INV-5): every segment must be a plain name, and the
/// resolved parent must still be inside the output tree after symlinks.
///
/// `Ok(None)` is an entry there is nothing to remove for: refused, or in a
/// folder that is gone. `Err` is a folder that could not be resolved either
/// way, so the file may well still be in it.
fn manifest_entry_path(out_dir: &Path, rel: &str) -> io::Result<Option<PathBuf>> {
    let mut path = out_dir.to_path_buf();
    for segment in rel.split(['/', '\\']) {
        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => path.push(name),
            _ => return Ok(None),
        }
    }
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Ok(None);
    };
    // Delete through the canonicalized parent, not the path as joined: an
    // intermediate component swapped for a symlink between the check and the
    // unlink would otherwise escape the directory that was checked.
    let parent = match parent.canonicalize() {
        Ok(parent) => parent,
        Err(e) if says_absent(&e) => return Ok(None),
        Err(e) => return Err(e),
    };
    Ok(parent.starts_with(out_dir).then(|| parent.join(name)))
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

/// What a prune did, once it got as far as pruning. From there a cleanup that
/// fell short is part of the result, not an `Err`: the count of what it did
/// remove would be lost with one (INV-7).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub removed: usize,
    /// Why outdated files may be left in the output, when they may.
    pub error: Option<String>,
}

/// The entries a previous export recorded, none when there was no previous
/// export. A manifest that is there but cannot be read or parsed is an error,
/// not an empty list: replacing it would orphan every file it claimed.
fn read_manifest(manifest: &Path) -> Result<Vec<String>, String> {
    let raw = match fs::read(manifest) {
        Ok(raw) => raw,
        Err(e) if says_absent(&e) => return Ok(Vec::new()),
        // Deleting it is the lossy way out, so that is not offered for a file
        // that may be fine and only out of reach right now.
        Err(e) => {
            return Err(format!(
                "Failed to read the manifest of the previous export ({e}). Nothing was cleaned \
                 up, and {SITE_MANIFEST_REL} was left as it is."
            ))
        }
    };
    serde_json::from_slice(&raw).map_err(|e| {
        format!(
            "The manifest of the previous export is not valid ({e}). Nothing was cleaned up; \
             repair or delete {SITE_MANIFEST_REL} in the output folder."
        )
    })
}

static STAGED_MANIFESTS: AtomicU64 = AtomicU64::new(0);

/// Where one write stages the manifest. The name is its own, so two exports
/// into one folder never touch each other's staging file.
fn staging_path(manifest: &Path) -> PathBuf {
    let nth = STAGED_MANIFESTS.fetch_add(1, Ordering::Relaxed);
    manifest.with_extension(format!("json.{}-{nth}.tmp", std::process::id()))
}

/// Replace the manifest in one step. Written in place, an export that was
/// interrupted, or that overlapped another, would leave half a manifest, and
/// one that does not parse stops every later cleanup until it is repaired.
fn write_manifest(manifest: &Path, claimed: &[String]) -> io::Result<()> {
    if let Some(parent) = manifest.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(claimed)?;
    let staged = staging_path(manifest);
    // `create_new` refuses whatever already holds the name, a link included,
    // rather than write through it.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)?;
    // Synced first: a rename that outlives a power cut must not name an empty file.
    let written = file
        .write_all(json.as_bytes())
        .and_then(|()| file.sync_all());
    drop(file);
    let moved = written.and_then(|()| fs::rename(&staged, manifest));
    if moved.is_err() {
        let _ = fs::remove_file(&staged);
    }
    moved
}

/// Whether a file that could not be removed is still in the output. A folder
/// at its path is not one of Glyph's files and never becomes removable, so it
/// does not count. A path that cannot be inspected does: dropping the claim on
/// a guess would orphan the file.
fn is_file_there(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(found) => !found.is_dir(),
        Err(e) => !says_absent(&e),
    }
}

/// What became of one stale manifest entry.
enum Pruned {
    Removed,
    /// Nothing of Glyph's is at the path, so the claim goes.
    Dropped,
    /// Still there, or impossible to tell: the claim stays and is reported.
    Stuck(io::Error),
}

fn prune_entry(out_dir: &Path, rel: &str) -> Pruned {
    let path = match manifest_entry_path(out_dir, rel) {
        Ok(Some(path)) => path,
        Ok(None) => return Pruned::Dropped,
        Err(e) => return Pruned::Stuck(e),
    };
    match fs::remove_file(&path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                prune_empty_dirs(parent, out_dir);
            }
            Pruned::Removed
        }
        Err(e) if is_file_there(&path) => Pruned::Stuck(e),
        Err(_) => Pruned::Dropped,
    }
}

/// The first failed removal in full and the rest as a count, so a folder of
/// locked pages still reads as one line.
fn summarize_stuck(first: Option<String>, count: usize) -> Option<String> {
    let first = first?;
    if count == 1 {
        return Some(first);
    }
    Some(format!(
        "{first} ({} more could not be removed either)",
        count - 1
    ))
}

/// Delete the files a previous website export left in `out_dir` that this one
/// did not write, then record what the output directory now holds of Glyph's.
/// Reports how many files were removed and, when a stale file could not be
/// removed or the record could not be written, why. A manifest that cannot be
/// read or parsed fails the command before anything is removed or replaced.
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
) -> Result<PruneReport, String> {
    let out_dir = grants.ensure_writable(&out_dir)?;
    let manifest = out_dir.join(SITE_MANIFEST_REL);
    // `out_dir` is checked and holds no link, but one below it leads anywhere,
    // and the manifest is read and replaced where it leads.
    let mut below_out_dir = manifest.ancestors().take_while(|path| *path != out_dir);
    if below_out_dir.any(is_symlink) {
        return Err(format!("Refusing to follow a link at {SITE_MANIFEST_REL}"));
    }
    let previous = read_manifest(&manifest)?;

    let keep: HashSet<String> = written.iter().map(|rel| manifest_entry_key(rel)).collect();
    let mut claimed = written;
    let mut removed = 0;
    let mut stuck_count = 0;
    let mut first_stuck = None;
    for rel in previous
        .iter()
        .filter(|rel| !keep.contains(&manifest_entry_key(rel)))
    {
        match prune_entry(&out_dir, rel) {
            Pruned::Removed => removed += 1,
            Pruned::Dropped => {}
            Pruned::Stuck(e) => {
                // Held open by another process, or in a folder that cannot be
                // written to: keep claiming it so a later export prunes it.
                // Dropping it here would orphan it in the output for good.
                claimed.push(rel.clone());
                stuck_count += 1;
                // Debug-quoted: the name is manifest input and reaches a terminal.
                first_stuck.get_or_insert_with(|| format!("Failed to remove {rel:?}: {e}"));
            }
        }
    }

    let stuck = summarize_stuck(first_stuck, stuck_count);
    let unrecorded = write_manifest(&manifest, &claimed)
        .err()
        .map(|e| format!("Failed to write {SITE_MANIFEST_REL}: {e}"));
    let error = match (stuck, unrecorded) {
        (Some(stuck), Some(unrecorded)) => Some(format!("{stuck}; {unrecorded}")),
        (stuck, unrecorded) => stuck.or(unrecorded),
    };
    Ok(PruneReport { removed, error })
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
    use crate::vault::test_support::link_folder;
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
    fn allow_document_asset_mirrors_media_beside_a_loose_file_only() {
        let dir = tempfile::TempDir::new().unwrap();
        let doc = dir.path().join("doc.md");
        let image = dir.path().join("diagram.png");
        let text = dir.path().join("notes.txt");
        for path in [&doc, &image, &text] {
            fs::write(path, "x").unwrap();
        }
        let arg = |path: &Path| path.to_string_lossy().to_string();

        let app = app_with_grants();
        let scope = app.asset_protocol_scope();
        assert!(allow_document_asset(app.handle().clone(), arg(&image)).is_err());
        assert!(!scope.is_allowed(&image));

        app.state::<GrantRegistry>().grant_file(&doc).unwrap();
        allow_document_asset(app.handle().clone(), arg(&image)).unwrap();
        assert!(scope.is_allowed(&image));

        assert!(allow_document_asset(app.handle().clone(), arg(&text)).is_err());
        assert!(!scope.is_allowed(&text));
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
    fn writes_through_a_link_to_a_missing_target_are_denied() {
        let outer = tempfile::TempDir::new().unwrap();
        let ws = outer.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let source = ws.join("real.md");
        fs::write(&source, "x").unwrap();
        // The target's folder exists, so a write that followed the link would
        // create the target there, outside the workspace.
        let planted = outer.path().join("planted.md");
        let link = ws.join("note.md");
        link_folder(&planted, &link);
        let arg = |path: &Path| path.to_string_lossy().to_string();

        let app = app_with_workspace(&ws);
        let grants = || app.state::<GrantRegistry>();
        for result in [
            write_file(arg(&link), "x".to_string(), grants()),
            write_binary_file(arg(&link), vec![1], grants()),
            copy_file(arg(&source), arg(&link), grants()),
            create_dir_all(arg(&link.join("sub")), grants()),
            prune_export_dir(arg(&link), vec![], grants()).map(|_| ()),
        ] {
            let err = result.expect_err("must be denied");
            assert!(
                err.starts_with("path is outside the allowed workspaces and files:"),
                "got: {err}"
            );
        }
        assert!(!planted.exists());
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

    fn prune(dir: &Path, written: &[&str]) -> Result<PruneReport, String> {
        let app = app_with_export_dir(dir);
        prune_export_dir(
            dir.to_string_lossy().to_string(),
            written.iter().map(|s| s.to_string()).collect(),
            app.state::<GrantRegistry>(),
        )
    }

    /// A prune that finished: `removed` stale files gone, nothing to report.
    fn clean(removed: usize) -> PruneReport {
        PruneReport {
            removed,
            error: None,
        }
    }

    /// Files that can be read but neither removed nor replaced for as long as
    /// this is alive.
    struct Held {
        #[cfg(windows)]
        _handles: Vec<fs::File>,
        #[cfg(unix)]
        folder: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for Held {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.folder, fs::Permissions::from_mode(0o755));
        }
    }

    /// Pin `names` in `<dir>/<folder>` the way each platform has it: another
    /// handle holding each file open without delete sharing on Windows, a
    /// folder that cannot be written to elsewhere (which root ignores, so
    /// these tests assume an ordinary user).
    fn hold(dir: &Path, folder: &str, names: &[&str]) -> Held {
        let folder = dir.join(folder);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_SHARE_READ: u32 = 1;
            let open = |name: &&str| {
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ)
                    .open(folder.join(name))
                    .unwrap()
            };
            Held {
                _handles: names.iter().map(open).collect(),
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = names;
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o555)).unwrap();
            Held { folder }
        }
    }

    /// Stale pages `names` in `<dir>/locked` that cannot be removed.
    fn stick(dir: &Path, names: &[&str]) -> Held {
        fs::create_dir_all(dir.join("locked")).unwrap();
        for name in names {
            fs::write(dir.join("locked").join(name), "stale").unwrap();
        }
        hold(dir, "locked", names)
    }

    /// A manifest that still reads and cannot be replaced.
    fn block_manifest_write(dir: &Path) -> Held {
        hold(dir, ".glyph", &["site-manifest.json"])
    }

    /// What `.glyph` holds, to tell a staging file that was left behind.
    fn glyph_folder(dir: &Path) -> Vec<String> {
        let entries = fs::read_dir(dir.join(".glyph")).unwrap();
        entries
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }

    /// The line the report carries for a stuck `rel`, with this platform's error.
    fn failure_line(dir: &Path, rel: &str) -> String {
        let os_error = fs::remove_file(dir.join(rel)).expect_err("the page is stuck");
        format!("Failed to remove {rel:?}: {os_error}")
    }

    fn manifest_text(dir: &Path) -> String {
        fs::read_to_string(dir.join(SITE_MANIFEST_REL)).unwrap()
    }

    #[test]
    fn prune_export_dir_removes_only_files_the_previous_export_wrote() {
        let dir = out_dir_with_manifest("prune_stale", &["index.html", "guide.html"]);
        fs::write(dir.join("index.html"), "home").unwrap();
        fs::write(dir.join("guide.html"), "stale").unwrap();
        // Not Glyph's file: a static host's marker the user keeps beside the site.
        fs::write(dir.join("CNAME"), "example.com").unwrap();

        assert_eq!(prune(&dir, &["index.html"]).unwrap(), clean(1));

        assert!(!dir.join("guide.html").exists());
        assert!(dir.join("index.html").exists());
        assert!(dir.join("CNAME").exists());
        // The manifest now describes this export, so the next one prunes against
        // it, and the copy it was staged in is not left beside it.
        assert_eq!(manifest_text(&dir), r#"["index.html"]"#);
        assert_eq!(glyph_folder(&dir), ["site-manifest.json"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_removes_directories_a_pruned_page_leaves_empty() {
        let dir = out_dir_with_manifest("prune_dirs", &["guide/intro.html"]);
        fs::create_dir_all(dir.join("guide")).unwrap();
        fs::write(dir.join("guide/intro.html"), "gone").unwrap();

        assert_eq!(prune(&dir, &[]).unwrap(), clean(1));

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

        assert_eq!(prune(&dir, &["index.html"]).unwrap(), clean(0));

        assert!(dir.join("keep.txt").exists());
        assert!(dir.join(SITE_MANIFEST_REL).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_leaves_a_manifest_that_does_not_parse_as_it_is() {
        let dir = out_dir_with_manifest("prune_bad", &[]);
        // Cut short, empty, the wrong shape, and not text at all.
        let contents: [&[u8]; 4] = [b"{ not json", b"", br#"{"pages":[]}"#, &[0xff, 0xfe]];
        for content in contents {
            fs::write(dir.join(SITE_MANIFEST_REL), content).unwrap();

            let err = prune(&dir, &["index.html"]).unwrap_err();

            assert!(
                err.starts_with("The manifest of the previous export is not valid ("),
                "got: {err}"
            );
            assert!(
                err.ends_with("repair or delete .glyph/site-manifest.json in the output folder."),
                "got: {err}"
            );
            // Replacing it would orphan whatever it claimed, with no way back.
            assert_eq!(fs::read(dir.join(SITE_MANIFEST_REL)).unwrap(), content);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_fails_on_a_manifest_it_cannot_read() {
        let dir =
            std::env::temp_dir().join(format!("glyph_test_prune_unread_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        // A directory where the manifest goes: there, and not readable as a file.
        fs::create_dir_all(dir.join(SITE_MANIFEST_REL)).unwrap();

        let err = prune(&dir, &["index.html"]).unwrap_err();

        assert!(
            err.starts_with("Failed to read the manifest of the previous export ("),
            "got: {err}"
        );
        // Deleting it is not the advice for a manifest that may be fine.
        assert!(
            err.ends_with(".glyph/site-manifest.json was left as it is."),
            "got: {err}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_reports_a_manifest_it_has_nowhere_to_write() {
        let dir =
            std::env::temp_dir().join(format!("glyph_test_prune_nowhere_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // A file where the manifest's folder goes: no previous export to read,
        // and no place to record this one.
        fs::write(dir.join(".glyph"), "not a folder").unwrap();

        let report = prune(&dir, &["index.html"]).unwrap();

        assert_eq!(report.removed, 0);
        let error = report.error.expect("the unwritten manifest is reported");
        assert!(
            error.starts_with("Failed to write .glyph/site-manifest.json: "),
            "got: {error}"
        );

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

        assert_eq!(prune(&dir, &[]).unwrap(), clean(0));

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

        assert_eq!(prune(&dir, &[]).unwrap().removed, 0);

        assert!(victim.exists());

        let _ = fs::remove_dir_all(&outer);
    }

    #[test]
    fn prune_export_dir_refuses_a_manifest_behind_a_link() {
        let outer = tempfile::TempDir::new().unwrap();
        let elsewhere = outer.path().join("elsewhere");
        let linked_folder = outer.path().join("site-a");
        let linked_file = outer.path().join("site-b");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::create_dir_all(&linked_folder).unwrap();
        fs::create_dir_all(linked_file.join(".glyph")).unwrap();
        link_folder(&elsewhere, &linked_folder.join(".glyph"));
        link_folder(
            &elsewhere.join("planted.json"),
            &linked_file.join(".glyph").join("site-manifest.json"),
        );

        for dir in [linked_folder, linked_file] {
            let err = prune(&dir, &["index.html"]).unwrap_err();
            assert!(err.contains("Refusing to follow a link"), "{err}");
        }
        // Nothing was written where either link leads.
        assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);
    }

    #[test]
    fn prune_export_dir_keeps_the_page_a_case_only_rename_rewrote() {
        // Windows and macOS write `Guide.html` and `guide.html` to one file,
        // so pruning the old spelling would delete the page just written.
        let dir = out_dir_with_manifest("prune_case", &["Guide.html"]);
        fs::write(dir.join("guide.html"), "the current page").unwrap();

        assert_eq!(prune(&dir, &["guide.html"]).unwrap(), clean(0));

        assert_eq!(
            fs::read_to_string(dir.join("guide.html")).unwrap(),
            "the current page"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_reports_a_file_it_could_not_remove_and_keeps_claiming_it() {
        let dir = out_dir_with_manifest("prune_stuck", &["locked/old.html"]);
        let stuck = stick(&dir, &["old.html"]);
        let failure = failure_line(&dir, "locked/old.html");

        let report = prune(&dir, &[]).unwrap();

        // The stale page is still published, so the prune must not read as clean.
        assert_eq!(report.removed, 0);
        assert_eq!(report.error, Some(failure));
        assert!(dir.join("locked/old.html").exists());
        // Dropping the claim would orphan it in the output for good.
        assert_eq!(manifest_text(&dir), r#"["locked/old.html"]"#);

        drop(stuck);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_quotes_the_name_of_a_file_it_could_not_remove() {
        // A hand-edited manifest picks the name, and the report goes to a
        // terminal: a control sequence and a text-direction override here.
        let hostile = "evil\u{9b}2J\u{202e}Exported";
        let rel = format!("locked/{hostile}");
        let dir = out_dir_with_manifest("prune_quote", &[rel.as_str()]);
        let stuck = stick(&dir, &[hostile]);

        let error = prune(&dir, &[]).unwrap().error.expect("it is reported");

        assert!(
            error.starts_with(r#"Failed to remove "locked/evil\u{9b}2J\u{202e}Exported": "#),
            "got: {error:?}"
        );
        assert!(!error.contains(['\u{9b}', '\u{202e}']), "got: {error:?}");

        drop(stuck);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_removes_a_stuck_file_once_it_can() {
        let dir = out_dir_with_manifest("prune_retry", &["locked/old.html"]);
        let stuck = stick(&dir, &["old.html"]);
        assert!(prune(&dir, &[]).unwrap().error.is_some());

        // Whatever held it lets go: the next export finishes the job.
        drop(stuck);

        assert_eq!(prune(&dir, &[]).unwrap(), clean(1));
        assert!(!dir.join("locked/old.html").exists());
        assert_eq!(manifest_text(&dir), "[]");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_counts_what_it_removed_beside_what_it_could_not() {
        let previous = [
            "locked/a.html",
            "old.html",
            "locked/b.html",
            "locked/c.html",
        ];
        let dir = out_dir_with_manifest("prune_mixed", &previous);
        let stuck = stick(&dir, &["a.html", "b.html", "c.html"]);
        let first_failure = failure_line(&dir, "locked/a.html");
        fs::write(dir.join("old.html"), "stale").unwrap();

        let report = prune(&dir, &["index.html"]).unwrap();

        assert_eq!(report.removed, 1);
        assert_eq!(
            report.error,
            Some(format!(
                "{first_failure} (2 more could not be removed either)"
            ))
        );
        assert!(!dir.join("old.html").exists());
        assert_eq!(
            manifest_text(&dir),
            r#"["index.html","locked/a.html","locked/b.html","locked/c.html"]"#
        );

        drop(stuck);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_forgets_a_file_that_is_already_gone() {
        // Deleted by hand since the last export, one with its whole folder:
        // nothing is left behind, so it is neither a removal nor a failure.
        let dir = out_dir_with_manifest("prune_gone", &["gone.html", "gone/page.html"]);

        assert_eq!(prune(&dir, &[]).unwrap(), clean(0));

        assert_eq!(manifest_text(&dir), "[]");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_forgets_a_name_this_volume_cannot_hold() {
        // Written on a system that allows such names and synced here, or put
        // in by hand: refused outright or just not found, depending on the
        // platform. Either way no such file is in this folder, and a warning
        // about it on every export would never stop.
        let too_long = format!("{}.html", "a".repeat(300));
        let previous = [
            "what?.html",
            "a\nb/page.html",
            "zero\0byte.html",
            too_long.as_str(),
        ];
        let dir = out_dir_with_manifest("prune_unholdable", &previous);

        assert_eq!(prune(&dir, &[]).unwrap(), clean(0));

        assert_eq!(manifest_text(&dir), "[]");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_forgets_a_claim_a_folder_now_stands_on() {
        // An extensionless file once exported to `docs/guide`, where the
        // workspace has since grown a folder: not Glyph's file, never removable.
        let dir = out_dir_with_manifest("prune_folder", &["docs/guide"]);
        fs::create_dir_all(dir.join("docs/guide")).unwrap();
        fs::write(dir.join("docs/guide/intro.html"), "current").unwrap();

        assert_eq!(prune(&dir, &["docs/guide/intro.html"]).unwrap(), clean(0));

        assert!(dir.join("docs/guide/intro.html").exists());
        assert_eq!(manifest_text(&dir), r#"["docs/guide/intro.html"]"#);

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn prune_export_dir_keeps_claiming_pages_in_a_folder_it_cannot_look_into() {
        use std::os::unix::fs::PermissionsExt;
        let previous = ["sealed/old.html", "sealed/deep/older.html"];
        let dir = out_dir_with_manifest("prune_sealed", &previous);
        let sealed = dir.join("sealed");
        fs::create_dir_all(sealed.join("deep")).unwrap();
        fs::write(sealed.join("old.html"), "stale").unwrap();
        fs::write(sealed.join("deep/older.html"), "stale").unwrap();
        fs::set_permissions(&sealed, fs::Permissions::from_mode(0o000)).unwrap();

        let report = prune(&dir, &[]).unwrap();

        fs::set_permissions(&sealed, fs::Permissions::from_mode(0o755)).unwrap();
        // Neither page can be seen, so neither can be called gone: one fails
        // at the removal, the other before its folder can even be resolved.
        assert_eq!(report.removed, 0);
        let error = report.error.expect("both are reported");
        assert!(
            error.starts_with(r#"Failed to remove "sealed/old.html": "#),
            "got: {error}"
        );
        assert!(
            error.ends_with("(1 more could not be removed either)"),
            "got: {error}"
        );
        assert!(sealed.join("old.html").exists());
        assert!(sealed.join("deep/older.html").exists());
        assert_eq!(
            manifest_text(&dir),
            r#"["sealed/old.html","sealed/deep/older.html"]"#
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_keeps_its_count_when_the_manifest_cannot_be_written() {
        let dir = out_dir_with_manifest("prune_unrecorded", &["index.html", "guide.html"]);
        fs::write(dir.join("guide.html"), "stale").unwrap();
        let blocked = block_manifest_write(&dir);

        let report = prune(&dir, &["index.html"]).unwrap();

        // The page is gone whether or not the record was written, so say so.
        assert_eq!(report.removed, 1);
        assert!(!dir.join("guide.html").exists());
        let error = report.error.expect("the unwritten manifest is reported");
        assert!(
            error.starts_with("Failed to write .glyph/site-manifest.json: "),
            "got: {error}"
        );
        // The previous manifest is whole, and the copy staged to replace it is gone.
        assert_eq!(manifest_text(&dir), r#"["index.html","guide.html"]"#);
        assert_eq!(glyph_folder(&dir), ["site-manifest.json"]);

        drop(blocked);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_export_dir_reports_a_stuck_file_and_an_unwritten_manifest_together() {
        let dir = out_dir_with_manifest("prune_both", &["locked/old.html"]);
        let stuck = stick(&dir, &["old.html"]);
        let failure = failure_line(&dir, "locked/old.html");
        let blocked = block_manifest_write(&dir);

        let error = prune(&dir, &[]).unwrap().error.expect("both are reported");

        assert!(
            error.starts_with(&format!(
                "{failure}; Failed to write .glyph/site-manifest.json: "
            )),
            "got: {error}"
        );

        drop((stuck, blocked));
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

        assert_eq!(
            prune(&dir, &["index.html", "guide.html"]).unwrap(),
            clean(0)
        );
        // Second export: guide.md is gone, so its page is no longer written.
        assert_eq!(prune(&dir, &["index.html"]).unwrap(), clean(1));

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

        assert_eq!(prune(&dir, &[]).unwrap().removed, 0);

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
    fn prune_report_serializes_a_clean_prune_with_a_null_error() {
        // The exporter tells a clean prune by `error === null`: a field left
        // out would read as a reason of `undefined`.
        let json = serde_json::to_string(&clean(2)).unwrap();
        assert_eq!(json, r#"{"removed":2,"error":null}"#);
    }
}
