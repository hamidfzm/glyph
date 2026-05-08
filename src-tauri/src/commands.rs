use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

const WALK_MAX_DEPTH: usize = 32;
const WALK_MAX_FILES: usize = 10_000;
const WALK_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".svn", ".hg"];
const SCAN_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const SCAN_MAX_SNIPPET: usize = 200;

pub struct InitialFile(pub Mutex<Option<String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: u64,
}

#[tauri::command]
pub fn get_initial_file(state: State<'_, InitialFile>) -> Option<String> {
    state.0.lock().ok()?.clone()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
pub fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("Failed to print: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_directory = metadata.is_dir();
        if !is_directory && !crate::is_markdown_file(&entry_path) {
            continue;
        }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(DirEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
            modified,
        });
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub fn list_markdown_files(path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let walker = WalkDir::new(root)
        .max_depth(WALK_MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip hidden entries and known noisy directories
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') && e.depth() > 0 {
                return false;
            }
            if e.file_type().is_dir() && WALK_SKIP_DIRS.contains(&name.as_ref()) {
                return false;
            }
            true
        });

    let mut results: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !crate::is_markdown_file(p) {
            continue;
        }
        if results.len() >= WALK_MAX_FILES {
            truncated = true;
            break;
        }
        results.push(p.to_string_lossy().to_string());
    }

    if truncated {
        eprintln!(
            "list_markdown_files: workspace at {} exceeds {} files; results truncated",
            path, WALK_MAX_FILES
        );
    }

    Ok(results)
}

#[tauri::command]
pub fn scan_wikilinks(path: String) -> Result<Vec<WikilinkRef>, String> {
    let root = Path::new(&path);
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
        if files_scanned >= WALK_MAX_FILES {
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

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    let metadata = fs::metadata(p).map_err(|e| format!("Failed to get metadata: {e}"))?;
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

    #[test]
    fn read_file_success() {
        let dir = std::env::temp_dir().join("glyph_test_read");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"# Hello\nWorld").unwrap();

        let result = read_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Hello\nWorld");

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn read_file_not_found() {
        let result = read_file("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read file"));
    }

    #[test]
    fn read_file_empty() {
        let dir = std::env::temp_dir().join("glyph_test_read_empty");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("empty.md");
        fs::File::create(&file_path).unwrap();

        let result = read_file(file_path.to_string_lossy().to_string());
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

        let result = read_file(file_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().contains("你好世界"));

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn get_metadata_success() {
        let dir = std::env::temp_dir().join("glyph_test_meta");
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join("meta_test.md");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"content").unwrap();

        let result = get_file_metadata(file_path.to_string_lossy().to_string());
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
        let result = get_file_metadata("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get metadata"));
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
    fn read_directory_lists_md_files_and_dirs() {
        let dir = unique_tmp("read_dir_basic");
        fs::write(dir.join("readme.md"), "x").unwrap();
        fs::write(dir.join("notes.markdown"), "x").unwrap();
        fs::write(dir.join("image.png"), b"x").unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"subdir"));
        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&"notes.markdown"));
        assert!(!names.contains(&"image.png"), "non-markdown files filtered out");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_skips_hidden_entries() {
        let dir = unique_tmp("read_dir_hidden");
        fs::write(dir.join("visible.md"), "x").unwrap();
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(names, vec!["visible.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_sorts_dirs_first_then_alpha() {
        let dir = unique_tmp("read_dir_sort");
        fs::write(dir.join("zeta.md"), "x").unwrap();
        fs::write(dir.join("alpha.md"), "x").unwrap();
        fs::create_dir_all(dir.join("beta")).unwrap();
        fs::create_dir_all(dir.join("Apple")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        let order: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(order, vec!["Apple", "beta", "alpha.md", "zeta.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_empty_dir_returns_empty() {
        let dir = unique_tmp("read_dir_empty");
        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_directory_not_found_returns_err() {
        let result = read_directory("/nonexistent/glyph/path/abc123".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read directory"));
    }

    #[test]
    fn list_markdown_files_walks_recursively() {
        let dir = unique_tmp("list_md_recursive");
        fs::write(dir.join("root.md"), "x").unwrap();
        fs::create_dir_all(dir.join("nested/deep")).unwrap();
        fs::write(dir.join("nested/a.md"), "x").unwrap();
        fs::write(dir.join("nested/deep/b.markdown"), "x").unwrap();
        fs::write(dir.join("nested/image.png"), b"x").unwrap();

        let mut result = list_markdown_files(dir.to_string_lossy().to_string()).unwrap();
        result.sort();
        let names: Vec<String> = result
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"root.md".to_string()));
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"b.markdown".to_string()));
        assert!(!names.iter().any(|n| n == "image.png"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_skips_hidden_and_noisy_dirs() {
        let dir = unique_tmp("list_md_skip");
        fs::write(dir.join("keep.md"), "x").unwrap();
        for skip in &[".git", "node_modules", "target", ".svn", ".hg"] {
            fs::create_dir_all(dir.join(skip)).unwrap();
            fs::write(dir.join(skip).join("ignored.md"), "x").unwrap();
        }
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/ignored.md"), "x").unwrap();

        let result = list_markdown_files(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<String> = result
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["keep.md".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_files_errors_on_non_directory() {
        let dir = unique_tmp("list_md_not_dir");
        let file = dir.join("file.md");
        fs::write(&file, "x").unwrap();

        let result = list_markdown_files(file.to_string_lossy().to_string());
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_finds_basic_targets() {
        let dir = unique_tmp("scan_basic");
        fs::write(dir.join("a.md"), "Read [[B]] today.\nAlso [[B|the second]].\n").unwrap();
        fs::write(dir.join("b.md"), "no links here").unwrap();

        let mut refs = scan_wikilinks(dir.to_string_lossy().to_string()).unwrap();
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

        let refs = scan_wikilinks(dir.to_string_lossy().to_string()).unwrap();
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

        let refs = scan_wikilinks(dir.to_string_lossy().to_string()).unwrap();
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
        fs::write(dir.join("a.md"), "line one\nline two has [[Target#section|alias]] here\n").unwrap();

        let refs = scan_wikilinks(dir.to_string_lossy().to_string()).unwrap();
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

        let refs = scan_wikilinks(dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(refs.len(), 1);
        assert!(refs[0].snippet.ends_with('…'));
        assert!(refs[0].snippet.chars().count() <= SCAN_MAX_SNIPPET + 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_wikilinks_errors_on_non_directory() {
        let dir = unique_tmp("scan_not_dir");
        let file = dir.join("a.md");
        fs::write(&file, "x").unwrap();
        let result = scan_wikilinks(file.to_string_lossy().to_string());
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
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

    #[test]
    fn dir_entry_camel_case_keys() {
        let entry = DirEntry {
            name: "file.md".to_string(),
            path: "/p/file.md".to_string(),
            is_directory: false,
            modified: 1,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"isDirectory\":false"));
        assert!(!json.contains("is_directory"));
    }
}
