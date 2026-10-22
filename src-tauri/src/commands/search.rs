use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

use super::walk::{workspace_walker, SCAN_MAX_FILE_BYTES, WALK_MAX_DEPTH, WALK_MAX_FILES};
use crate::grants::GrantRegistry;

/// Stop once this many matches are collected: a one-character query would
/// otherwise stream a whole vault into the panel.
const MAX_MATCHES: usize = 500;
/// Characters of context kept on either side of a match. A minified or
/// single-line document would otherwise send megabytes per row.
const CONTEXT_CHARS: usize = 120;
/// Bytes that are sure to hold `CONTEXT_CHARS` characters: four per character,
/// plus the three a window edge may move to land on a character boundary.
const CONTEXT_BYTES: usize = CONTEXT_CHARS * 4 + 3;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1-based line number, as shown in the result row.
    pub line: usize,
    /// Byte offset of the match within its line. Only ever used as an identity,
    /// since clipping can leave two matches on a line with identical context.
    pub column: usize,
    pub before: String,
    /// The matched fragment; the frontend renders exactly this highlighted, so
    /// it never has to reproduce Rust's byte offsets in UTF-16 land.
    pub text: String,
    pub after: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub files: Vec<FileMatches>,
    pub total: usize,
    /// True when a cap cut the scan short, so the UI can say "refine this".
    pub truncated: bool,
    /// Files left unread because they are over the size cap.
    pub oversized: usize,
}

/// Literal, whole-word, and regex queries all compile to one `Regex`, so the
/// three toggles never grow separate matching paths.
fn build_pattern(query: &str, options: &SearchOptions) -> Result<Regex, String> {
    let body = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if options.whole_word {
        format!(r"\b(?:{body})\b")
    } else {
        body
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|e| format!("Invalid search pattern: {e}"))
}

/// The last `CONTEXT_CHARS` characters of `text`, marked when some were cut.
/// Only a bounded tail of the bytes is read: counting the characters of a
/// whole single-line document once per match made the search quadratic.
fn clip_start(text: &str) -> String {
    let from = text.len().saturating_sub(CONTEXT_BYTES);
    let window = &text[char_boundary_at_or_after(text, from)..];
    // Where the last CONTEXT_CHARS characters of the window begin.
    let kept = window
        .char_indices()
        .rev()
        .nth(CONTEXT_CHARS - 1)
        .map_or(0, |(at, _)| at);
    if kept == 0 && window.len() == text.len() {
        return text.to_string();
    }
    format!("\u{2026}{}", &window[kept..])
}

/// The first `CONTEXT_CHARS` characters of `text`, marked when some were cut.
fn clip_end(text: &str) -> String {
    let window = &text[..char_boundary_at_or_before(text, CONTEXT_BYTES)];
    // Where the character after the first CONTEXT_CHARS begins.
    match window.char_indices().nth(CONTEXT_CHARS) {
        Some((cut, _)) => format!("{}\u{2026}", &window[..cut]),
        None if window.len() == text.len() => text.to_string(),
        None => format!("{window}\u{2026}"),
    }
}

fn char_boundary_at_or_after(text: &str, at: usize) -> usize {
    (at..=text.len())
        .find(|&i| text.is_char_boundary(i))
        .unwrap_or(text.len())
}

fn char_boundary_at_or_before(text: &str, at: usize) -> usize {
    (0..=at.min(text.len()))
        .rev()
        .find(|&i| text.is_char_boundary(i))
        .unwrap_or(0)
}

/// Collect at most `remaining` matches from `content`. The bool is true when
/// that budget ran out mid-file.
fn search_text(pattern: &Regex, content: &str, remaining: usize) -> (Vec<SearchMatch>, bool) {
    let mut matches = Vec::new();
    for (index, line) in content.lines().enumerate() {
        for found in pattern.find_iter(line) {
            if matches.len() >= remaining {
                return (matches, true);
            }
            matches.push(SearchMatch {
                line: index + 1,
                column: found.start(),
                before: clip_start(&line[..found.start()]),
                text: clip_end(found.as_str()),
                after: clip_end(&line[found.end()..]),
            });
        }
    }
    (matches, false)
}

#[tauri::command]
pub fn search_workspace(
    path: String,
    query: String,
    options: SearchOptions,
    grants: State<'_, GrantRegistry>,
) -> Result<SearchResults, String> {
    grants.ensure_readable(&path)?;
    search_workspace_capped(&path, &query, &options, MAX_MATCHES, WALK_MAX_FILES)
}

/// Body of [`search_workspace`] with the caps as parameters, so the
/// truncation branches are testable without authoring 500 matches or
/// `WALK_MAX_FILES` real files.
fn search_workspace_capped(
    path: &str,
    query: &str,
    options: &SearchOptions,
    max_matches: usize,
    max_files: usize,
) -> Result<SearchResults, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    if query.is_empty() {
        return Ok(SearchResults {
            files: Vec::new(),
            total: 0,
            truncated: false,
            oversized: 0,
        });
    }
    let pattern = build_pattern(query, options)?;

    let mut files: Vec<FileMatches> = Vec::new();
    let mut total = 0;
    let mut scanned = 0;
    let mut truncated = false;
    let mut oversized = 0;
    for entry in workspace_walker(root, WALK_MAX_DEPTH) {
        if !entry.file_type().is_file() {
            continue;
        }
        let file = entry.path();
        if !crate::is_markdown_file(file) {
            continue;
        }
        if scanned >= max_files {
            truncated = true;
            break;
        }
        scanned += 1;
        // The index leaves files over the cap out too; here one is counted
        // rather than read, so the result says what was not searched.
        if entry
            .metadata()
            .is_ok_and(|meta| meta.len() > SCAN_MAX_FILE_BYTES)
        {
            oversized += 1;
            continue;
        }
        // Non-UTF-8 content is skipped rather than failing the whole search.
        let Ok(content) = fs::read_to_string(file) else {
            continue;
        };
        let (matches, hit_cap) = search_text(&pattern, &content, max_matches - total);
        total += matches.len();
        if !matches.is_empty() {
            files.push(FileMatches {
                path: file.to_string_lossy().to_string(),
                matches,
            });
        }
        if hit_cap {
            truncated = true;
            break;
        }
    }

    Ok(SearchResults {
        files,
        total,
        truncated,
        oversized,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::Manager;

    fn literal() -> SearchOptions {
        SearchOptions::default()
    }

    fn unique_tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_search_{}_{}_{}",
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

    fn app_with_workspace(dir: &Path) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
        app
    }

    fn search(dir: &Path, query: &str, options: &SearchOptions) -> SearchResults {
        search_workspace_capped(
            &dir.to_string_lossy(),
            query,
            options,
            MAX_MATCHES,
            WALK_MAX_FILES,
        )
        .unwrap()
    }

    #[test]
    fn finds_matches_across_files_with_line_and_context() {
        let dir = unique_tmp("across_files");
        fs::write(dir.join("a.md"), "intro\nthe needle is here\n").unwrap();
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("nested/b.md"), "another needle line\n").unwrap();
        fs::write(dir.join("c.md"), "nothing to see\n").unwrap();

        let results = search(&dir, "needle", &literal());

        assert_eq!(results.total, 2);
        assert_eq!(results.files.len(), 2);
        assert!(!results.truncated);
        let first = &results.files[0].matches[0];
        assert_eq!(first.line, 2);
        assert_eq!(first.column, 4);
        assert_eq!(first.before, "the ");
        assert_eq!(first.text, "needle");
        assert_eq!(first.after, " is here");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn matching_is_case_insensitive_until_the_toggle_is_on() {
        let dir = unique_tmp("case");
        fs::write(dir.join("a.md"), "Needle\nneedle\n").unwrap();

        assert_eq!(search(&dir, "needle", &literal()).total, 2);

        let sensitive = SearchOptions {
            case_sensitive: true,
            ..Default::default()
        };
        let results = search(&dir, "needle", &sensitive);
        assert_eq!(results.total, 1);
        assert_eq!(results.files[0].matches[0].line, 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn whole_word_rejects_substring_hits() {
        let dir = unique_tmp("whole_word");
        fs::write(dir.join("a.md"), "cat\nconcatenate\n").unwrap();

        assert_eq!(search(&dir, "cat", &literal()).total, 2);

        let whole = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        let results = search(&dir, "cat", &whole);
        assert_eq!(results.total, 1);
        assert_eq!(results.files[0].matches[0].line, 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn regex_metacharacters_are_literal_until_the_toggle_is_on() {
        let dir = unique_tmp("regex");
        fs::write(dir.join("a.md"), "a.c\nabc\n").unwrap();

        let literal_hits = search(&dir, "a.c", &literal());
        assert_eq!(literal_hits.total, 1);
        assert_eq!(literal_hits.files[0].matches[0].line, 1);

        let regex = SearchOptions {
            regex: true,
            ..Default::default()
        };
        assert_eq!(search(&dir, "a.c", &regex).total, 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_invalid_regex_is_an_error_not_a_panic() {
        let dir = unique_tmp("bad_regex");
        fs::write(dir.join("a.md"), "text\n").unwrap();

        let regex = SearchOptions {
            regex: true,
            ..Default::default()
        };
        let err = search_workspace_capped(
            &dir.to_string_lossy(),
            "a(",
            &regex,
            MAX_MATCHES,
            WALK_MAX_FILES,
        )
        .expect_err("must reject the pattern");
        assert!(err.starts_with("Invalid search pattern:"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_query_returns_nothing() {
        let dir = unique_tmp("empty_query");
        fs::write(dir.join("a.md"), "text\n").unwrap();

        let results = search(&dir, "", &literal());
        assert_eq!(results.total, 0);
        assert!(results.files.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_match_cap_truncates_instead_of_streaming_everything() {
        let dir = unique_tmp("cap");
        fs::write(dir.join("a.md"), "hit\nhit\nhit\nhit\n").unwrap();

        let results =
            search_workspace_capped(&dir.to_string_lossy(), "hit", &literal(), 2, WALK_MAX_FILES)
                .unwrap();
        assert_eq!(results.total, 2);
        assert!(results.truncated);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_file_cap_truncates_the_walk() {
        let dir = unique_tmp("file_cap");
        fs::write(dir.join("a.md"), "hit\n").unwrap();
        fs::write(dir.join("b.md"), "hit\n").unwrap();

        let results =
            search_workspace_capped(&dir.to_string_lossy(), "hit", &literal(), MAX_MATCHES, 1)
                .unwrap();
        // Sorted traversal makes the covered file deterministic.
        assert_eq!(results.files.len(), 1);
        assert!(results.files[0].path.ends_with("a.md"));
        assert!(results.truncated);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_utf8_files_are_skipped_not_fatal() {
        let dir = unique_tmp("non_utf8");
        fs::write(dir.join("a.md"), b"\xff\xfe broken bytes \xff").unwrap();
        fs::write(dir.join("b.md"), "the needle survives\n").unwrap();

        let results = search(&dir, "needle", &literal());
        assert_eq!(results.total, 1);
        assert_eq!(results.files.len(), 1);
        assert!(results.files[0].path.ends_with("b.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn long_lines_are_clipped_around_the_match() {
        let dir = unique_tmp("clip");
        let padding = "x".repeat(CONTEXT_CHARS * 2);
        fs::write(dir.join("a.md"), format!("{padding}needle{padding}\n")).unwrap();

        let found = &search(&dir, "needle", &literal()).files[0].matches[0];
        assert_eq!(found.before.chars().count(), CONTEXT_CHARS + 1);
        assert!(found.before.starts_with('\u{2026}'));
        assert_eq!(found.after.chars().count(), CONTEXT_CHARS + 1);
        assert!(found.after.ends_with('\u{2026}'));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_markdown_and_hidden_files_are_skipped() {
        let dir = unique_tmp("filter");
        fs::write(dir.join("a.md"), "needle\n").unwrap();
        fs::write(dir.join("b.json"), "needle\n").unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/c.md"), "needle\n").unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/d.md"), "needle\n").unwrap();

        let results = search(&dir, "needle", &literal());
        assert_eq!(results.total, 1);
        assert!(results.files[0].path.ends_with("a.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn denied_without_a_grant() {
        let dir = unique_tmp("denied");
        fs::write(dir.join("a.md"), "needle\n").unwrap();

        let app = mock_app();
        app.manage(GrantRegistry::default());
        let err = search_workspace(
            dir.to_string_lossy().to_string(),
            "needle".to_string(),
            SearchOptions::default(),
            app.state::<GrantRegistry>(),
        )
        .expect_err("must be denied");
        assert!(err.starts_with("path is outside the allowed workspaces and files:"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn errors_on_a_non_directory() {
        let dir = unique_tmp("not_dir");
        let file = dir.join("a.md");
        fs::write(&file, "needle\n").unwrap();

        let app = app_with_workspace(&dir);
        let result = search_workspace(
            file.to_string_lossy().to_string(),
            "needle".to_string(),
            SearchOptions::default(),
            app.state::<GrantRegistry>(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn results_serialize_with_camel_case_keys() {
        let results = SearchResults {
            files: vec![FileMatches {
                path: "/p/a.md".to_string(),
                matches: vec![SearchMatch {
                    line: 1,
                    column: 0,
                    before: String::new(),
                    text: "hit".to_string(),
                    after: String::new(),
                }],
            }],
            total: 1,
            truncated: false,
            oversized: 0,
        };
        let json = serde_json::to_string(&results).unwrap();
        assert!(json.contains("\"truncated\":false"));
        assert!(json.contains("\"oversized\":0"));
        assert!(json.contains("\"line\":1"));
    }

    #[test]
    fn clipping_keeps_whole_characters_at_both_edges() {
        let short = "é".repeat(CONTEXT_CHARS);
        assert_eq!(clip_start(&short), short);
        assert_eq!(clip_end(&short), short);

        let long = "é".repeat(CONTEXT_CHARS + 50);
        let start = clip_start(&long);
        assert!(start.starts_with('\u{2026}'));
        assert_eq!(start.chars().count(), CONTEXT_CHARS + 1);
        let end = clip_end(&long);
        assert!(end.ends_with('\u{2026}'));
        assert_eq!(end.chars().count(), CONTEXT_CHARS + 1);

        // Four-byte characters fill the byte window exactly.
        let wide = "\u{1F600}".repeat(CONTEXT_CHARS * 3);
        assert_eq!(clip_start(&wide).chars().count(), CONTEXT_CHARS + 1);
        assert_eq!(clip_end(&wide).chars().count(), CONTEXT_CHARS + 1);
        assert_eq!(clip_end("abc"), "abc");
        assert_eq!(clip_start(""), "");
    }

    #[test]
    fn a_single_line_document_with_many_matches_clips_in_bounded_time() {
        let dir = unique_tmp("long_line");
        let line = "needle ".repeat(MAX_MATCHES) + &"x".repeat(4 * 1024 * 1024);
        fs::write(dir.join("a.md"), format!("{line}needle\n")).unwrap();

        let started = std::time::Instant::now();
        let results = search(&dir, "needle", &literal());
        assert_eq!(results.total, MAX_MATCHES);
        assert!(results.truncated);
        let took = started.elapsed();
        assert!(took < std::time::Duration::from_secs(2), "took {took:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn files_over_the_size_cap_are_counted_not_read() {
        let dir = unique_tmp("oversized");
        fs::write(dir.join("a.md"), "needle\n").unwrap();
        // A sparse file: the size is what matters, not what it holds.
        let huge = fs::File::create(dir.join("huge.md")).unwrap();
        huge.set_len(SCAN_MAX_FILE_BYTES + 1).unwrap();

        let results = search(&dir, "needle", &literal());
        assert_eq!(results.total, 1);
        assert_eq!(results.oversized, 1);
        assert!(!results.truncated);
        let _ = fs::remove_dir_all(&dir);
    }
}
