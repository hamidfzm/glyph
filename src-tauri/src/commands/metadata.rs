use serde::Serialize;
use std::path::Path;

use super::walk::{scan_files, ScanStatus, WALK_MAX_DEPTH, WALK_MAX_FILES};
use crate::grants::GrantRegistry;
use crate::vault::{inline_tags, split_frontmatter};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEntry {
    /// Absolute path of the scanned file.
    pub path: String,
    /// Raw frontmatter block, delimiters included, or `None` when the file has
    /// none. Left unparsed so the frontend runs the same YAML parser that
    /// renders the block, instead of a second dialect drifting from it.
    pub frontmatter: Option<String>,
    /// Inline `#tag` tokens in the body, lowercased and deduplicated.
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataScan {
    pub files: Vec<MetadataEntry>,
    pub status: ScanStatus,
}

#[tauri::command]
pub fn scan_metadata(
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
) -> Result<MetadataScan, String> {
    grants.ensure_readable(&path)?;
    scan_metadata_capped(&path, WALK_MAX_FILES, WALK_MAX_DEPTH)
}

/// Body of [`scan_metadata`] with the caps as parameters, so the truncation
/// branches are testable without creating `WALK_MAX_FILES` real files.
fn scan_metadata_capped(
    path: &str,
    max_files: usize,
    max_depth: usize,
) -> Result<MetadataScan, String> {
    let mut files: Vec<MetadataEntry> = Vec::new();
    let status = scan_files(
        Path::new(path),
        crate::is_markdown_file,
        max_files,
        max_depth,
        |p, content| {
            // Rebuilt with newline endings so the frontend parser sees one
            // shape regardless of the file's own line endings.
            let (inner, body_start) = split_frontmatter(content);
            let frontmatter = inner.map(|inner| format!("---\n{inner}---\n"));
            let tags = inline_tags(content.lines().skip(body_start));
            if frontmatter.is_none() && tags.is_empty() {
                return;
            }
            files.push(MetadataEntry {
                path: p.to_string_lossy().to_string(),
                frontmatter,
                tags,
            });
        },
    )?;

    Ok(MetadataScan { files, status })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::walk::WALK_MAX_DEPTH;
    use crate::vault::{MAX_INLINE_TAGS_PER_FILE, MAX_TAG_CHARS};
    use std::fs;
    use std::time::UNIX_EPOCH;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;

    fn app_with_workspace(dir: &Path) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
        app
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

    fn scan(dir: &Path) -> Vec<MetadataEntry> {
        scan_metadata(
            dir.to_string_lossy().to_string(),
            app_with_workspace(dir).state::<GrantRegistry>(),
        )
        .unwrap()
        .files
    }

    #[test]
    fn scan_metadata_returns_the_raw_frontmatter_block() {
        let dir = unique_tmp("meta_frontmatter");
        fs::write(
            dir.join("a.md"),
            "---\ntitle: Note\nstatus: draft\n---\n\nBody text\n",
        )
        .unwrap();

        let files = scan(&dir);
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].frontmatter.as_deref(),
            Some("---\ntitle: Note\nstatus: draft\n---\n")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_normalises_crlf_frontmatter() {
        let dir = unique_tmp("meta_crlf");
        fs::write(dir.join("a.md"), "---\r\ntitle: Note\r\n---\r\nBody\r\n").unwrap();

        let files = scan(&dir);
        assert_eq!(
            files[0].frontmatter.as_deref(),
            Some("---\ntitle: Note\n---\n")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_skips_files_without_metadata() {
        let dir = unique_tmp("meta_none");
        fs::write(dir.join("plain.md"), "Just prose, no metadata.\n").unwrap();
        fs::write(dir.join("tagged.md"), "Prose with #alpha in it.\n").unwrap();

        let files = scan(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].path.ends_with("tagged.md"));
        assert_eq!(files[0].tags, vec!["alpha"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_ignores_an_unclosed_frontmatter_fence() {
        let dir = unique_tmp("meta_unclosed");
        fs::write(dir.join("a.md"), "---\ntitle: Note\n\nBody #alpha\n").unwrap();

        let files = scan(&dir);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].frontmatter, None);
        assert_eq!(files[0].tags, vec!["alpha"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_collects_inline_tags_outside_frontmatter_and_fences() {
        let dir = unique_tmp("meta_tags");
        fs::write(
            dir.join("a.md"),
            "---\ntags: [front]\n# not-a-tag: comment\n---\n#alpha and #Beta/nested\n```\n#fenced\n```\n#alpha again, issue #42, mid#word\n",
        )
        .unwrap();

        let files = scan(&dir);
        assert_eq!(files[0].tags, vec!["alpha", "beta/nested"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_drops_oversized_frontmatter_but_keeps_inline_tags() {
        let dir = unique_tmp("meta_big_frontmatter");
        let filler = "x".repeat(9000);
        fs::write(
            dir.join("a.md"),
            format!("---\nnote: {filler}\n---\nBody #alpha\n"),
        )
        .unwrap();

        let files = scan(&dir);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].frontmatter, None);
        assert_eq!(files[0].tags, vec!["alpha"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_caps_tag_length_and_count() {
        let dir = unique_tmp("meta_tag_caps");
        let long = "y".repeat(MAX_TAG_CHARS + 1);
        let many: String = (0..MAX_INLINE_TAGS_PER_FILE + 10)
            .map(|i| format!("#tag{i} "))
            .collect();
        fs::write(dir.join("a.md"), format!("#{long} #ok\n{many}\n")).unwrap();

        let files = scan(&dir);
        assert_eq!(files[0].tags.len(), MAX_INLINE_TAGS_PER_FILE);
        assert!(!files[0].tags.iter().any(|t| t.len() > MAX_TAG_CHARS));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_reports_the_file_cap() {
        let dir = unique_tmp("meta_cap");
        fs::write(dir.join("a.md"), "#alpha").unwrap();
        fs::write(dir.join("b.md"), "#beta").unwrap();

        let result = scan_metadata_capped(&dir.to_string_lossy(), 1, WALK_MAX_DEPTH).unwrap();
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.status, ScanStatus::file_limit(1));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_denied_without_a_grant() {
        let dir = unique_tmp("meta_denied");
        fs::write(dir.join("a.md"), "#alpha").unwrap();

        let app = mock_app();
        app.manage(GrantRegistry::default());
        let result = scan_metadata(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        let err = result.expect_err("must be denied");
        assert!(err.starts_with("path is outside the allowed workspaces and files:"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_metadata_errors_on_non_directory() {
        let dir = unique_tmp("meta_not_dir");
        let file = dir.join("a.md");
        fs::write(&file, "#alpha").unwrap();
        let app = app_with_workspace(&dir);
        let result = scan_metadata(
            file.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
