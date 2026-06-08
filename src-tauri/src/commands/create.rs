//! Create, rename, and delete entries from the file-tree menu.
//!
//! Every path is validated to live inside the workspace `root` (after
//! canonicalization) so a crafted `dir`/`path` can't touch anything outside the
//! open workspace. New entries get collision-safe default names; the frontend
//! then lets the user rename them inline, and confirms before deleting.

use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_NOTE_STEM: &str = "Untitled";
const DEFAULT_FOLDER_NAME: &str = "Untitled Folder";

/// Ensure `target_parent` resolves to a directory inside `root`. Both are
/// canonicalized so `..` segments and symlinks can't escape the workspace.
fn ensure_within_root(target_parent: &Path, root: &Path) -> Result<(), String> {
    let parent = target_parent
        .canonicalize()
        .map_err(|e| format!("Invalid directory: {e}"))?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;
    if !parent.starts_with(&root) {
        return Err("Refusing to write outside the workspace".to_string());
    }
    Ok(())
}

/// Pick the first non-colliding name in `dir` built from `stem`/`ext`:
/// `Untitled.md`, `Untitled 1.md`, … (or `Untitled Folder`, `Untitled Folder 1`).
fn unique_path(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let build = |name: String| -> PathBuf {
        match ext {
            Some(ext) => dir.join(format!("{name}.{ext}")),
            None => dir.join(name),
        }
    };
    let mut candidate = build(stem.to_string());
    let mut n = 1;
    while candidate.exists() {
        candidate = build(format!("{stem} {n}"));
        n += 1;
    }
    candidate
}

/// Reduce a user-typed name to a single safe path component: drops directory
/// separators and characters that are illegal on Windows, trims whitespace.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
pub fn create_note(dir: String, root: String) -> Result<String, String> {
    let dir = Path::new(&dir);
    ensure_within_root(dir, Path::new(&root))?;
    let path = unique_path(dir, DEFAULT_NOTE_STEM, Some("md"));
    fs::write(&path, "").map_err(|e| format!("Failed to create note: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_folder(dir: String, root: String) -> Result<String, String> {
    let dir = Path::new(&dir);
    ensure_within_root(dir, Path::new(&root))?;
    let path = unique_path(dir, DEFAULT_FOLDER_NAME, None);
    fs::create_dir(&path).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Rename `path` to `new_name` within the same directory. Used by the inline
/// rename after a create. The extension of the original file is preserved when
/// the typed name doesn't carry one (so "My Note" stays a `.md` file). Returns
/// the final (collision-safe) path.
#[tauri::command]
pub fn rename_path(path: String, new_name: String, root: String) -> Result<String, String> {
    let source = Path::new(&path);
    let parent = source
        .parent()
        .ok_or_else(|| "Path has no parent directory".to_string())?;
    ensure_within_root(parent, Path::new(&root))?;

    let sanitized = sanitize_name(&new_name);
    if sanitized.is_empty() {
        return Err("Name is empty".to_string());
    }

    // Preserve the source extension when the typed name omits one and the source
    // is a file (folders never get an extension).
    let typed = Path::new(&sanitized);
    let (stem, ext) = if typed.extension().is_none() && source.is_file() {
        (
            sanitized.as_str(),
            source.extension().and_then(|e| e.to_str()),
        )
    } else {
        let stem = typed
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&sanitized);
        (stem, typed.extension().and_then(|e| e.to_str()))
    };

    // Renaming to the current name (including typing it without its extension) is
    // a no-op; return before unique_path would bump it to "<name> 1".
    let desired = match ext {
        Some(ext) => parent.join(format!("{stem}.{ext}")),
        None => parent.join(stem),
    };
    if desired == source {
        return Ok(path);
    }

    let target = unique_path(parent, stem, ext);
    fs::rename(source, &target).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Duplicate a note or folder next to itself: `Note.md` → `Note copy.md`
/// (`Note copy 1.md` on collision), `Folder` → `Folder copy`. Returns the new
/// path. Folders are copied recursively. Validated to stay inside `root`.
#[tauri::command]
pub fn duplicate_path(path: String, root: String) -> Result<String, String> {
    let source = Path::new(&path);
    let parent = source
        .parent()
        .ok_or_else(|| "Path has no parent directory".to_string())?;
    ensure_within_root(parent, Path::new(&root))?;

    let ext = source.extension().and_then(|e| e.to_str());
    let stem = if ext.is_some() {
        source.file_stem().and_then(|s| s.to_str())
    } else {
        source.file_name().and_then(|s| s.to_str())
    }
    .ok_or_else(|| "Invalid file name".to_string())?;

    let dest = unique_path(parent, &format!("{stem} copy"), ext);
    if source.is_dir() {
        copy_dir_recursive(source, &dest)
            .map_err(|e| format!("Failed to duplicate folder: {e}"))?;
    } else {
        fs::copy(source, &dest).map_err(|e| format!("Failed to duplicate: {e}"))?;
    }
    Ok(dest.to_string_lossy().to_string())
}

/// Move a note or folder into `to_dir` (same name, collision-safe). Both the
/// source's parent and the destination must be inside `root`, and a folder
/// can't be moved into itself or a descendant. Returns the new path; a move
/// into the current directory is a no-op that returns the original path.
#[tauri::command]
pub fn move_path(from: String, to_dir: String, root: String) -> Result<String, String> {
    let source = Path::new(&from);
    let dest_dir = Path::new(&to_dir);
    let parent = source
        .parent()
        .ok_or_else(|| "Path has no parent directory".to_string())?;
    ensure_within_root(parent, Path::new(&root))?;
    ensure_within_root(dest_dir, Path::new(&root))?;

    let source_abs = source
        .canonicalize()
        .map_err(|e| format!("Invalid source: {e}"))?;
    let dest_abs = dest_dir
        .canonicalize()
        .map_err(|e| format!("Invalid destination: {e}"))?;
    if dest_abs == source_abs || dest_abs.starts_with(&source_abs) {
        return Err("Can't move an item into itself".to_string());
    }
    // Moving into the current parent is a no-op.
    if parent.canonicalize().ok() == Some(dest_abs) {
        return Ok(from);
    }

    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let typed = Path::new(name);
    let target = if let Some(ext) = typed.extension().and_then(|e| e.to_str()) {
        let stem = typed.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
        unique_path(dest_dir, stem, Some(ext))
    } else {
        unique_path(dest_dir, name, None)
    };

    fs::rename(source, &target).map_err(|e| format!("Failed to move: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// Permanently delete a note or folder. The frontend always confirms first.
/// Folders are removed recursively. Validated to stay inside `root`.
#[tauri::command]
pub fn delete_path(path: String, root: String) -> Result<(), String> {
    let target = Path::new(&path);
    let parent = target
        .parent()
        .ok_or_else(|| "Path has no parent directory".to_string())?;
    ensure_within_root(parent, Path::new(&root))?;
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| format!("Failed to delete folder: {e}"))
    } else {
        fs::remove_file(target).map_err(|e| format!("Failed to delete: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_create_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_note_makes_untitled_md() {
        let dir = unique_tmp("note");
        let root = dir.to_string_lossy().to_string();
        let path = create_note(root.clone(), root.clone()).unwrap();
        assert!(path.ends_with("Untitled.md"));
        assert!(Path::new(&path).is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_note_dedupes_on_collision() {
        let dir = unique_tmp("note_dupe");
        let root = dir.to_string_lossy().to_string();
        let first = create_note(root.clone(), root.clone()).unwrap();
        let second = create_note(root.clone(), root.clone()).unwrap();
        assert!(first.ends_with("Untitled.md"));
        assert!(second.ends_with("Untitled 1.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_folder_makes_untitled_folder() {
        let dir = unique_tmp("folder");
        let root = dir.to_string_lossy().to_string();
        let path = create_folder(root.clone(), root.clone()).unwrap();
        assert!(path.ends_with("Untitled Folder"));
        assert!(Path::new(&path).is_dir());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_in_subdir_within_root_is_allowed() {
        let root = unique_tmp("sub_root");
        let sub = root.join("notes");
        fs::create_dir(&sub).unwrap();
        let path = create_note(
            sub.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();
        assert!(Path::new(&path).starts_with(&sub));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_outside_root_is_refused() {
        let root = unique_tmp("guard_root");
        let outside = unique_tmp("guard_outside");
        let result = create_note(
            outside.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside the workspace"));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn rename_preserves_extension_when_omitted() {
        let dir = unique_tmp("rename_ext");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let renamed = rename_path(note, "My Note".to_string(), root.clone()).unwrap();
        assert!(renamed.ends_with("My Note.md"));
        assert!(Path::new(&renamed).is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_dedupes_on_collision() {
        let dir = unique_tmp("rename_dupe");
        let root = dir.to_string_lossy().to_string();
        fs::write(dir.join("Taken.md"), "x").unwrap();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let renamed = rename_path(note, "Taken".to_string(), root.clone()).unwrap();
        assert!(renamed.ends_with("Taken 1.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_strips_illegal_characters() {
        let dir = unique_tmp("rename_illegal");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let renamed = rename_path(note, "a/b:c*?".to_string(), root.clone()).unwrap();
        assert!(renamed.ends_with("abc.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_empty_name_errors() {
        let dir = unique_tmp("rename_empty");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let result = rename_path(note, "   ".to_string(), root.clone());
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_keeps_typed_extension() {
        let dir = unique_tmp("rename_typed_ext");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let renamed = rename_path(note, "readme.markdown".to_string(), root.clone()).unwrap();
        assert!(renamed.ends_with("readme.markdown"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_folder_has_no_extension() {
        let root = unique_tmp("rename_folder");
        let root_s = root.to_string_lossy().to_string();
        let folder = create_folder(root_s.clone(), root_s.clone()).unwrap();
        let renamed = rename_path(folder, "Archive".to_string(), root_s.clone()).unwrap();
        assert!(renamed.ends_with("Archive"));
        assert!(Path::new(&renamed).is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_removes_a_file() {
        let dir = unique_tmp("delete_file");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        assert!(Path::new(&note).is_file());
        delete_path(note.clone(), root.clone()).unwrap();
        assert!(!Path::new(&note).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_a_folder_recursively() {
        let root = unique_tmp("delete_folder");
        let root_s = root.to_string_lossy().to_string();
        let folder = create_folder(root_s.clone(), root_s.clone()).unwrap();
        fs::write(Path::new(&folder).join("inner.md"), "x").unwrap();
        delete_path(folder.clone(), root_s.clone()).unwrap();
        assert!(!Path::new(&folder).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn duplicate_file_appends_copy() {
        let dir = unique_tmp("dupe_file");
        let root = dir.to_string_lossy().to_string();
        let note = create_note(root.clone(), root.clone()).unwrap();
        let renamed = rename_path(note, "Note".to_string(), root.clone()).unwrap();
        let copy = duplicate_path(renamed, root.clone()).unwrap();
        assert!(copy.ends_with("Note copy.md"));
        assert!(Path::new(&copy).is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_dedupes_copies() {
        let dir = unique_tmp("dupe_dupe");
        let root = dir.to_string_lossy().to_string();
        fs::write(dir.join("Note.md"), "body").unwrap();
        let first = duplicate_path(
            dir.join("Note.md").to_string_lossy().to_string(),
            root.clone(),
        )
        .unwrap();
        let second = duplicate_path(
            dir.join("Note.md").to_string_lossy().to_string(),
            root.clone(),
        )
        .unwrap();
        assert!(first.ends_with("Note copy.md"));
        assert!(second.ends_with("Note copy 1.md"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "body");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_folder_copies_recursively() {
        let root = unique_tmp("dupe_folder");
        let root_s = root.to_string_lossy().to_string();
        let folder = create_folder(root_s.clone(), root_s.clone()).unwrap();
        let folder = rename_path(folder, "Docs".to_string(), root_s.clone()).unwrap();
        fs::write(Path::new(&folder).join("a.md"), "x").unwrap();
        let copy = duplicate_path(folder, root_s.clone()).unwrap();
        assert!(copy.ends_with("Docs copy"));
        assert!(Path::new(&copy).join("a.md").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn duplicate_outside_root_is_refused() {
        let root = unique_tmp("dupe_guard_root");
        let outside = unique_tmp("dupe_guard_outside");
        let victim = outside.join("v.md");
        fs::write(&victim, "x").unwrap();
        let result = duplicate_path(
            victim.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn move_relocates_a_file_into_a_subfolder() {
        let root = unique_tmp("move_file");
        let root_s = root.to_string_lossy().to_string();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(root.join("note.md"), "body").unwrap();

        let moved = move_path(
            root.join("note.md").to_string_lossy().to_string(),
            sub.to_string_lossy().to_string(),
            root_s.clone(),
        )
        .unwrap();
        assert_eq!(Path::new(&moved), sub.join("note.md"));
        assert!(!root.join("note.md").exists());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "body");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_dedupes_on_collision() {
        let root = unique_tmp("move_dupe");
        let root_s = root.to_string_lossy().to_string();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("note.md"), "existing").unwrap();
        fs::write(root.join("note.md"), "moved").unwrap();

        let moved = move_path(
            root.join("note.md").to_string_lossy().to_string(),
            sub.to_string_lossy().to_string(),
            root_s.clone(),
        )
        .unwrap();
        assert!(moved.ends_with("note 1.md"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_into_same_dir_is_a_noop() {
        let root = unique_tmp("move_noop");
        let root_s = root.to_string_lossy().to_string();
        fs::write(root.join("note.md"), "x").unwrap();
        let from = root.join("note.md").to_string_lossy().to_string();
        let moved = move_path(from.clone(), root_s.clone(), root_s.clone()).unwrap();
        assert_eq!(moved, from);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_folder_into_itself_is_refused() {
        let root = unique_tmp("move_self");
        let root_s = root.to_string_lossy().to_string();
        let folder = root.join("Docs");
        fs::create_dir(&folder).unwrap();
        let result = move_path(
            folder.to_string_lossy().to_string(),
            folder.to_string_lossy().to_string(),
            root_s.clone(),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_outside_root_is_refused() {
        let root = unique_tmp("move_guard_root");
        let outside = unique_tmp("move_guard_outside");
        fs::write(root.join("note.md"), "x").unwrap();
        let result = move_path(
            root.join("note.md").to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(root.join("note.md").exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn rename_to_same_name_is_a_noop() {
        let dir = unique_tmp("rename_noop");
        let root = dir.to_string_lossy().to_string();
        fs::write(dir.join("note.md"), "body").unwrap();
        let path = dir.join("note.md").to_string_lossy().to_string();
        // Typing the name without its extension resolves to the same file.
        let renamed = rename_path(path.clone(), "note".to_string(), root.clone()).unwrap();
        assert_eq!(renamed, path);
        assert!(dir.join("note.md").is_file());
        assert!(!dir.join("note 1.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_file_without_extension() {
        let dir = unique_tmp("rename_noext");
        let root = dir.to_string_lossy().to_string();
        fs::write(dir.join("LICENSE"), "x").unwrap();
        let renamed = rename_path(
            dir.join("LICENSE").to_string_lossy().to_string(),
            "COPYING".to_string(),
            root.clone(),
        )
        .unwrap();
        assert!(renamed.ends_with("COPYING"));
        assert!(!renamed.ends_with(".md"));
        assert!(Path::new(&renamed).is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_folder_copies_nested_subdirs() {
        let root = unique_tmp("dupe_nested");
        let root_s = root.to_string_lossy().to_string();
        let docs = root.join("Docs");
        fs::create_dir(&docs).unwrap();
        let nested = docs.join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("deep.md"), "deep").unwrap();
        let copy = duplicate_path(docs.to_string_lossy().to_string(), root_s.clone()).unwrap();
        assert!(copy.ends_with("Docs copy"));
        assert!(Path::new(&copy).join("nested").join("deep.md").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_relocates_a_folder_without_extension() {
        let root = unique_tmp("move_folder");
        let root_s = root.to_string_lossy().to_string();
        let docs = root.join("Docs");
        fs::create_dir(&docs).unwrap();
        fs::write(docs.join("a.md"), "x").unwrap();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        let moved = move_path(
            docs.to_string_lossy().to_string(),
            sub.to_string_lossy().to_string(),
            root_s.clone(),
        )
        .unwrap();
        assert_eq!(Path::new(&moved), sub.join("Docs"));
        assert!(sub.join("Docs").join("a.md").is_file());
        assert!(!docs.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_outside_root_is_refused() {
        let root = unique_tmp("delete_guard_root");
        let outside = unique_tmp("delete_guard_outside");
        let victim = outside.join("victim.md");
        fs::write(&victim, "x").unwrap();
        let result = delete_path(
            victim.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(victim.exists(), "guarded file must survive");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
