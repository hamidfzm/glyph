use serde::Serialize;
use std::fs;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

pub(crate) const WALK_MAX_DEPTH: usize = 32;
pub(crate) const WALK_MAX_FILES: usize = 10_000;
pub(crate) const WALK_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".svn", ".hg"];
pub(crate) const SCAN_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// Whether a workspace scan covered every file, returned alongside the items
/// so the UI can warn instead of presenting a truncated index as complete.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub truncated: bool,
    /// "fileLimit" or "depthLimit"; None when the scan is complete.
    pub reason: Option<&'static str>,
    /// The configured cap behind the reported reason.
    pub limit: Option<usize>,
}

impl ScanStatus {
    pub fn complete() -> Self {
        Self {
            truncated: false,
            reason: None,
            limit: None,
        }
    }

    pub fn file_limit(limit: usize) -> Self {
        Self {
            truncated: true,
            reason: Some("fileLimit"),
            limit: Some(limit),
        }
    }

    pub fn depth_limit(limit: usize) -> Self {
        Self {
            truncated: true,
            reason: Some("depthLimit"),
            limit: Some(limit),
        }
    }
}

/// Shared workspace walker: bounded depth, no symlinks, hidden and noisy
/// directories skipped. Sorted by file name so traversal order (and therefore
/// which files a capped scan covers) is deterministic across platforms.
pub(crate) fn workspace_walker(root: &Path, max_depth: usize) -> impl Iterator<Item = DirEntry> {
    WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') && e.depth() > 0 {
                return false;
            }
            if e.file_type().is_dir() && WALK_SKIP_DIRS.contains(&name.as_ref()) {
                return false;
            }
            true
        })
        .flatten()
}

/// Read every file under `root` that `accept` selects, within the scan caps,
/// and hand its path and contents to `visit`. Oversized and non-UTF-8 files are
/// skipped so one unreadable note can't fail a whole workspace index.
pub(crate) fn scan_files(
    root: &Path,
    accept: fn(&Path) -> bool,
    max_files: usize,
    max_depth: usize,
    mut visit: impl FnMut(&Path, &str),
) -> Result<ScanStatus, String> {
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }

    let mut status = ScanStatus::complete();
    let mut files_scanned = 0usize;
    for entry in workspace_walker(root, max_depth) {
        if entry.file_type().is_dir() {
            // A directory yielded at the depth cap is not descended into, so
            // its contents are missing from the index.
            if entry.depth() >= max_depth {
                status = ScanStatus::depth_limit(max_depth);
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !accept(path) {
            continue;
        }
        if files_scanned >= max_files {
            status = ScanStatus::file_limit(max_files);
            break;
        }
        files_scanned += 1;

        // An unreadable stat leaves the file in: `read_to_string` below is the
        // real gate, and the size check is only there to skip the huge ones.
        if entry
            .metadata()
            .is_ok_and(|m| m.len() > SCAN_MAX_FILE_BYTES)
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        visit(path, &content);
    }

    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Symlinks are not followed, so a linked note is yielded as a symlink entry
    // and must be skipped rather than read (it would otherwise be a way out of
    // the granted workspace). Unix-only: creating a symlink on Windows needs
    // elevation or Developer Mode.
    #[cfg(unix)]
    #[test]
    fn scan_markdown_files_skips_symlinked_entries() {
        let dir = std::env::temp_dir().join(format!("glyph_walk_symlink_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("real.md"), "body").unwrap();
        let _ = std::os::unix::fs::symlink(dir.join("real.md"), dir.join("link.md"));

        let mut seen: Vec<String> = Vec::new();
        let status = scan_files(
            &dir,
            crate::is_markdown_file,
            WALK_MAX_FILES,
            WALK_MAX_DEPTH,
            |path, _| {
                seen.push(path.file_name().unwrap().to_string_lossy().to_string());
            },
        )
        .unwrap();

        assert_eq!(seen, vec!["real.md"]);
        assert_eq!(status, ScanStatus::complete());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_status_camel_case_keys() {
        let json = serde_json::to_string(&ScanStatus::file_limit(10)).unwrap();
        assert!(json.contains("\"truncated\":true"));
        assert!(json.contains("\"reason\":\"fileLimit\""));
        assert!(json.contains("\"limit\":10"));

        let json = serde_json::to_string(&ScanStatus::complete()).unwrap();
        assert!(json.contains("\"truncated\":false"));
        assert!(json.contains("\"reason\":null"));
    }
}
