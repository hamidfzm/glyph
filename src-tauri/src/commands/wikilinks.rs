use serde::Serialize;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use super::walk::{WALK_MAX_DEPTH, WALK_MAX_FILES, WALK_SKIP_DIRS};
use crate::grants::GrantRegistry;

const SCAN_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const SCAN_MAX_SNIPPET: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikilinkRef {
    /// Absolute path of the file containing the wikilink.
    pub source: String,
    /// Raw target as written, including any `name|alias` and `#heading`.
    pub target: String,
    /// 1-based line number of the match.
    pub line: u32,
    /// Trimmed snippet of surrounding text (line, capped to ~200 chars).
    pub snippet: String,
}

#[tauri::command]
pub fn scan_wikilinks(
    path: String,
    grants: tauri::State<'_, GrantRegistry>,
) -> Result<Vec<WikilinkRef>, String> {
    grants.ensure_readable(&path)?;
    scan_wikilinks_capped(&path, WALK_MAX_FILES)
}

/// Body of [`scan_wikilinks`] with the file cap as a parameter, so the
/// truncation branch is testable without creating `WALK_MAX_FILES` real files.
fn scan_wikilinks_capped(path: &str, max_files: usize) -> Result<Vec<WikilinkRef>, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let walker = WalkDir::new(root)
        .max_depth(WALK_MAX_DEPTH)
        .follow_links(false)
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
        });

    let mut refs: Vec<WikilinkRef> = Vec::new();
    let mut files_scanned = 0usize;
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !crate::is_markdown_file(p) {
            continue;
        }
        if files_scanned >= max_files {
            break;
        }
        files_scanned += 1;

        if let Ok(meta) = entry.metadata() {
            if meta.len() > SCAN_MAX_FILE_BYTES {
                continue;
            }
        }

        let Ok(content) = fs::read_to_string(p) else {
            continue;
        };
        let source = p.to_string_lossy().to_string();
        scan_wikilinks_in_file(&content, &source, &mut refs);
    }

    Ok(refs)
}

fn scan_wikilinks_in_file(content: &str, source: &str, out: &mut Vec<WikilinkRef>) {
    let mut in_fence = false;
    for (idx, line) in content.lines().enumerate() {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let bytes = line.as_bytes();
        let mut i = 0;
        while i + 1 < bytes.len() {
            if bytes[i] != b'[' || bytes[i + 1] != b'[' {
                i += 1;
                continue;
            }
            let inner_start = i + 2;
            let mut j = inner_start;
            let mut found = false;
            while j + 1 < bytes.len() {
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    found = true;
                    break;
                }
                j += 1;
            }
            if !found {
                break;
            }
            if let Ok(target_str) = std::str::from_utf8(&bytes[inner_start..j]) {
                let target = target_str.trim();
                if !target.is_empty() && !target.contains('\n') {
                    out.push(WikilinkRef {
                        source: source.to_string(),
                        target: target.to_string(),
                        line: (idx + 1) as u32,
                        snippet: snippet_for(line),
                    });
                }
            }
            i = j + 2;
        }
    }
}

fn snippet_for(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= SCAN_MAX_SNIPPET {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(SCAN_MAX_SNIPPET).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;

    fn app_with_workspace(dir: &std::path::Path) -> tauri::App<MockRuntime> {
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

    #[test]
    fn scan_wikilinks_finds_basic_targets() {
        let dir = unique_tmp("scan_basic");
        fs::write(
            dir.join("a.md"),
            "Read [[B]] today.\nAlso [[B|the second]].\n",
        )
        .unwrap();
        fs::write(dir.join("b.md"), "no links here").unwrap();

        let mut refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        refs.sort_by_key(|r| (r.source.clone(), r.line));
        let from_a: Vec<_> = refs.iter().filter(|r| r.source.ends_with("a.md")).collect();
        assert_eq!(from_a.len(), 2);
        assert_eq!(from_a[0].target, "B");
        assert_eq!(from_a[0].line, 1);
        assert_eq!(from_a[1].target, "B|the second");
        assert_eq!(from_a[1].line, 2);
        assert!(from_a[0].snippet.contains("[[B]]"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_skips_fenced_code() {
        let dir = unique_tmp("scan_fenced");
        fs::write(
            dir.join("a.md"),
            "before [[Real]]\n```\n[[InsideFence]]\n```\nafter [[AlsoReal]]\n",
        )
        .unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert!(targets.contains(&"Real"));
        assert!(targets.contains(&"AlsoReal"));
        assert!(!targets.contains(&"InsideFence"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_handles_multiple_per_line() {
        let dir = unique_tmp("scan_multi");
        fs::write(dir.join("a.md"), "[[One]] then [[Two]] then [[Three]]\n").unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["One", "Two", "Three"]);
        for r in &refs {
            assert_eq!(r.line, 1);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_records_line_and_snippet() {
        let dir = unique_tmp("scan_meta");
        fs::write(
            dir.join("a.md"),
            "line one\nline two has [[Target#section|alias]] here\n",
        )
        .unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].line, 2);
        assert_eq!(refs[0].target, "Target#section|alias");
        assert!(refs[0].snippet.starts_with("line two has"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_truncates_long_snippets() {
        let dir = unique_tmp("scan_long");
        let long_line = format!("{}[[Target]]{}", "x".repeat(150), "y".repeat(150));
        fs::write(dir.join("a.md"), &long_line).unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        assert_eq!(refs.len(), 1);
        assert!(refs[0].snippet.ends_with('…'));
        assert!(refs[0].snippet.chars().count() <= SCAN_MAX_SNIPPET + 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_denied_without_a_grant() {
        let dir = unique_tmp("scan_denied");
        fs::write(dir.join("a.md"), "[[B]]").unwrap();

        let app = mock_app();
        app.manage(GrantRegistry::default());
        let result = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        let err = result.expect_err("must be denied");
        assert!(err.starts_with("path is outside the allowed workspaces and files:"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_errors_on_non_directory() {
        let dir = unique_tmp("scan_not_dir");
        let file = dir.join("a.md");
        fs::write(&file, "x").unwrap();
        let app = app_with_workspace(&dir);
        let result = scan_wikilinks(
            file.to_string_lossy().to_string(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_skips_hidden_and_noisy_dirs() {
        let dir = unique_tmp("scan_skip_dirs");
        fs::write(dir.join("keep.md"), "see [[Kept]]").unwrap();
        for skip in WALK_SKIP_DIRS {
            fs::create_dir_all(dir.join(skip)).unwrap();
            fs::write(dir.join(skip).join("ignored.md"), "see [[Skipped]]").unwrap();
        }
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/ignored.md"), "see [[Hidden]]").unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["Kept"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_skips_non_markdown_files() {
        let dir = unique_tmp("scan_non_md");
        fs::write(dir.join("a.md"), "see [[FromMd]]").unwrap();
        fs::write(dir.join("notes.txt"), "see [[FromTxt]]").unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["FromMd"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_skips_oversized_files() {
        let dir = unique_tmp("scan_oversize");
        let mut big = String::from("see [[FromBig]]\n");
        big.push_str(&"x".repeat(SCAN_MAX_FILE_BYTES as usize + 1));
        fs::write(dir.join("big.md"), big).unwrap();
        fs::write(dir.join("small.md"), "see [[FromSmall]]").unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["FromSmall"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_skips_files_that_are_not_valid_utf8() {
        let dir = unique_tmp("scan_bad_utf8");
        fs::write(
            dir.join("bad.md"),
            [0xff, 0xfe, b'[', b'[', b'X', b']', b']'],
        )
        .unwrap();
        fs::write(dir.join("good.md"), "see [[Good]]").unwrap();

        let refs = scan_wikilinks(
            dir.to_string_lossy().to_string(),
            app_with_workspace(&dir).state::<GrantRegistry>(),
        )
        .unwrap();
        let targets: Vec<&str> = refs.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["Good"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_stops_scanning_at_the_file_cap() {
        let dir = unique_tmp("scan_cap");
        fs::write(dir.join("a.md"), "see [[FromA]]").unwrap();
        fs::write(dir.join("b.md"), "see [[FromB]]").unwrap();

        let refs = scan_wikilinks_capped(&dir.to_string_lossy(), 1).unwrap();
        assert_eq!(refs.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_in_file_ignores_unclosed_brackets() {
        let mut out = Vec::new();
        scan_wikilinks_in_file("an [[Unclosed link\nthen [[Closed]]\n", "/x/a.md", &mut out);
        let targets: Vec<&str> = out.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["Closed"]);
    }

    #[test]
    fn scan_wikilinks_in_file_ignores_empty_targets() {
        let mut out = Vec::new();
        scan_wikilinks_in_file(
            "empty [[]] and blank [[   ]] but [[Real]]\n",
            "/x/a.md",
            &mut out,
        );
        let targets: Vec<&str> = out.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(targets, vec!["Real"]);
    }

    #[test]
    fn wikilink_ref_camel_case_keys() {
        let r = WikilinkRef {
            source: "/x/a.md".to_string(),
            target: "B".to_string(),
            line: 3,
            snippet: "see [[B]]".to_string(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"source\":"));
        assert!(json.contains("\"line\":3"));
        assert!(!json.contains("source_path"));
    }
}
