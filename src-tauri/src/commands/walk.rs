use serde::Serialize;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

pub(super) const WALK_MAX_DEPTH: usize = 32;
pub(super) const WALK_MAX_FILES: usize = 10_000;
pub(super) const WALK_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".svn", ".hg"];

/// Whether a workspace scan covered every file, returned alongside the items
/// so the UI can warn instead of presenting a truncated index as complete.
#[derive(Debug, PartialEq, Serialize)]
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
pub(super) fn workspace_walker(root: &Path, max_depth: usize) -> impl Iterator<Item = DirEntry> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
