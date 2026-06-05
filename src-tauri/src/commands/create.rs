//! Create and rename entries from the file-tree menu.
//!
//! Every path is validated to live inside the workspace `root` (after
//! canonicalization) so a crafted `dir`/`path` can't write outside the open
//! workspace. New entries get collision-safe default names; the frontend then
//! lets the user rename them inline.

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
    let target = if typed.extension().is_none() && source.is_file() {
        if let Some(ext) = source.extension().and_then(|e| e.to_str()) {
            unique_path(parent, &sanitized, Some(ext))
        } else {
            unique_path(parent, &sanitized, None)
        }
    } else {
        let stem = typed
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&sanitized);
        let ext = typed.extension().and_then(|e| e.to_str());
        unique_path(parent, stem, ext)
    };

    if target == source {
        return Ok(path);
    }
    fs::rename(source, &target).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(target.to_string_lossy().to_string())
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
}
