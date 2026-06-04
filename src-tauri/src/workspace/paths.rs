//! Workspace-relative path normalization.
//!
//! Paths stored in `.glyph/` must be relative to the workspace root and use
//! forward slashes so they stay valid across machines and operating
//! systems. We never normalize by string-replacing separators — that
//! breaks on Windows verbatim (`\\?\`) and UNC prefixes. Instead we strip
//! the root prefix and iterate `Component`s, which is canonical on every
//! platform.

use std::path::{Component, Path, PathBuf};

/// Convert an absolute `file` under `workspace_root` into a workspace-relative,
/// forward-slash path. `Err` when `file` is not inside `workspace_root`, or
/// equals it (no file component).
pub fn to_workspace_relative(workspace_root: &Path, file: &Path) -> Result<String, String> {
    let rel = file.strip_prefix(workspace_root).map_err(|_| {
        format!(
            "{} is not inside the workspace {}",
            file.display(),
            workspace_root.display()
        )
    })?;
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        return Err("path resolves to the workspace root, not a file".to_string());
    }
    Ok(parts.join("/"))
}

/// Join a forward-slash workspace-relative path back onto `workspace_root`,
/// producing a native absolute path. Rejects `..` and rooted/absolute
/// segments so a corrupt or hostile `state.json` from a clone can't point
/// outside the workspace.
pub fn from_workspace_relative(workspace_root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = workspace_root.to_path_buf();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("workspace-relative path may not contain `..`".to_string());
        }
        // A forward-slash relative path should never carry a drive letter
        // or backslash; reject defensively so traversal can't sneak in.
        if seg.contains('\\') || seg.contains(':') {
            return Err(format!("invalid workspace-relative segment: {seg}"));
        }
        out.push(seg);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_relative_uses_forward_slashes_without_leading_slash() {
        let root = Path::new("/home/u/workspace");
        let file = Path::new("/home/u/workspace/notes/todo.md");
        assert_eq!(to_workspace_relative(root, file).unwrap(), "notes/todo.md");
    }

    #[test]
    fn to_relative_errors_when_outside_root() {
        let root = Path::new("/home/u/workspace");
        let file = Path::new("/home/u/other/todo.md");
        assert!(to_workspace_relative(root, file).is_err());
    }

    #[test]
    fn to_relative_errors_when_equal_to_root() {
        let root = Path::new("/home/u/workspace");
        assert!(to_workspace_relative(root, root).is_err());
    }

    #[test]
    fn from_relative_rejects_parent_traversal() {
        let root = Path::new("/home/u/workspace");
        assert!(from_workspace_relative(root, "../escape.md").is_err());
        assert!(from_workspace_relative(root, "a/../../escape.md").is_err());
    }

    #[test]
    fn round_trips_to_the_original_path() {
        let root = Path::new("/home/u/workspace");
        let file = Path::new("/home/u/workspace/a/b/c.md");
        let rel = to_workspace_relative(root, file).unwrap();
        assert_eq!(
            from_workspace_relative(root, &rel).unwrap(),
            file.to_path_buf()
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_backslash_root_normalizes_to_forward_slashes() {
        let root = Path::new(r"C:\Users\u\workspace");
        let file = Path::new(r"C:\Users\u\workspace\notes\todo.md");
        assert_eq!(to_workspace_relative(root, file).unwrap(), "notes/todo.md");
        let back = from_workspace_relative(root, "notes/todo.md").unwrap();
        assert_eq!(back, PathBuf::from(r"C:\Users\u\workspace\notes\todo.md"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_rejects_backslash_or_drive_in_segment() {
        let root = Path::new(r"C:\Users\u\workspace");
        assert!(from_workspace_relative(root, r"notes\todo.md").is_err());
        assert!(from_workspace_relative(root, "C:/evil").is_err());
    }
}
