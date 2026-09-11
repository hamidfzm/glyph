//! Per-note extraction: what one file contributes to the index.

use std::collections::BTreeMap;

use super::frontmatter::{parse_frontmatter, split_frontmatter};
use super::tags::{add_tags, inline_tags};

pub const MAX_SNIPPET_CHARS: usize = 200;

#[derive(Debug, PartialEq)]
pub(crate) struct Link {
    /// Target as written, with `|alias` and `#heading` removed.
    pub target: String,
    /// 1-based, as the backlinks panel shows it.
    pub line: u32,
    pub snippet: String,
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Note {
    pub path: String,
    pub title: Option<String>,
    /// Frontmatter and inline tags, normalized, deduplicated and sorted.
    pub tags: Vec<String>,
    /// Frontmatter fields by lowercased name, `tags` excluded.
    pub fields: BTreeMap<String, String>,
    pub aliases: Vec<String>,
    pub links: Vec<Link>,
}

pub(crate) fn extract_note(path: &str, content: &str) -> Note {
    let (block, body_start) = split_frontmatter(content);
    let parsed = block.as_deref().and_then(parse_frontmatter);

    let mut tags: Vec<String> = Vec::new();
    for tag in inline_tags(content.lines().skip(body_start)) {
        add_tags(&tag, &mut tags);
    }

    let mut fields: BTreeMap<String, String> = BTreeMap::new();
    let mut title = None;
    let mut aliases = Vec::new();
    if let Some(parsed) = parsed {
        for tag in &parsed.tags {
            add_tags(tag, &mut tags);
        }
        if let Some(value) = &parsed.title {
            fields.insert("title".to_string(), value.clone());
        }
        if let Some(value) = &parsed.author {
            fields.insert("author".to_string(), value.clone());
        }
        if let Some(value) = &parsed.date {
            fields.insert("date".to_string(), value.clone());
        }
        // Extras land last, so a `Title:` key lowercases onto `title` exactly
        // as it does in the renderer's index.
        for (key, value) in &parsed.extra {
            fields.insert(key.to_lowercase(), value.clone());
        }
        title = parsed.title;
        aliases = parsed.aliases;
    }
    tags.sort();

    Note {
        path: path.to_string(),
        title,
        tags,
        fields,
        aliases,
        links: parse_links(content, body_start),
    }
}

/// Every `[[target]]` and `![[embed]]` outside fenced code, in source order.
/// The frontmatter block is skipped the way the tag scan skips it: the
/// renderer shows those lines as a table, never as links.
fn parse_links(content: &str, body_start: usize) -> Vec<Link> {
    let mut links = Vec::new();
    let mut in_fence = false;

    for (idx, line) in content.lines().enumerate().skip(body_start) {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        push_line_links(line, (idx + 1) as u32, &mut links);
    }

    links
}

fn push_line_links(line: &str, line_number: u32, out: &mut Vec<Link>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] != '[' || chars[i + 1] != '[' {
            i += 1;
            continue;
        }
        // The inner text may not span a `]`, matching the renderer's pattern,
        // so `[[a]b]]` is text rather than a link to `a]b`.
        let start = i + 2;
        let Some(close) = (start..chars.len()).find(|&j| chars[j] == ']') else {
            break;
        };
        if close + 1 >= chars.len() || chars[close + 1] != ']' || close == start {
            i += 1;
            continue;
        }

        let inner: String = chars[start..close].iter().collect();
        if let Some(target) = link_target(&inner) {
            out.push(Link {
                target,
                line: line_number,
                snippet: snippet_for(line),
            });
        }
        i = close + 2;
    }
}

/// The note `name#heading|alias` points at. The heading and the alias are
/// display concerns the renderer splits out for itself; the index only needs
/// to know which file the link reaches.
fn link_target(inner: &str) -> Option<String> {
    let target_with_heading = match inner.split_once('|') {
        Some((target, _)) => target,
        None => inner,
    };
    let target = match target_with_heading.split_once('#') {
        Some((target, _)) => target,
        None => target_with_heading,
    };
    let target = target.trim();
    (!target.is_empty()).then(|| target.to_string())
}

pub fn snippet_for(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_SNIPPET_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(MAX_SNIPPET_CHARS).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_links_from_start(content: &str) -> Vec<Link> {
        parse_links(content, 0)
    }

    fn targets(content: &str) -> Vec<String> {
        parse_links_from_start(content)
            .into_iter()
            .map(|link| link.target)
            .collect()
    }

    #[test]
    fn a_link_carries_its_target_line_and_snippet() {
        let links = parse_links_from_start("intro\nsee [[Target#Section|the alias]] here\n");
        assert_eq!(links.len(), 1);
        // The heading and the alias are display concerns the renderer splits
        // out for itself, so the index keeps only the file the link reaches.
        assert_eq!(links[0].target, "Target");
        assert_eq!(links[0].line, 2);
        assert!(links[0].snippet.starts_with("see [[Target"));
    }

    #[test]
    fn an_embed_reaches_the_same_target_as_a_plain_link() {
        assert_eq!(targets("![[Board]] and [[Board]]\n"), ["Board", "Board"]);
    }

    #[test]
    fn several_links_on_one_line_are_all_found() {
        assert_eq!(
            targets("[[One]] then [[Two]] then [[Three]]\n"),
            ["One", "Two", "Three"]
        );
    }

    #[test]
    fn fenced_code_holds_no_links() {
        assert_eq!(
            targets("before [[Real]]\n```\n[[Fenced]]\n```\nafter [[Also]]\n"),
            ["Real", "Also"]
        );
    }

    #[test]
    fn unclosed_empty_and_bracketed_targets_are_not_links() {
        assert_eq!(targets("an [[Unclosed link\nthen [[Closed]]\n"), ["Closed"]);
        assert_eq!(
            targets("empty [[]] blank [[   ]] real [[Real]]\n"),
            ["Real"]
        );
        // The renderer's pattern refuses a `]` inside, so this is plain text.
        assert!(targets("[[a]b]]\n").is_empty());
    }

    #[test]
    fn a_heading_only_target_is_not_a_link() {
        assert!(targets("see [[#Section]]\n").is_empty());
    }

    #[test]
    fn a_link_written_in_frontmatter_is_not_an_edge() {
        // Those lines render as a table, so the renderer makes no link there
        // and neither does the index.
        let note = extract_note("/w/a.md", "---\nsee: \"[[Elsewhere]]\"\n---\n\n[[Real]]\n");
        assert_eq!(note.links.len(), 1);
        assert_eq!(note.links[0].target, "Real");
        assert_eq!(note.links[0].line, 5);
    }

    #[test]
    fn long_lines_are_truncated_in_the_snippet() {
        let line = format!("{}[[Target]]{}", "x".repeat(150), "y".repeat(150));
        let links = parse_links_from_start(&line);
        assert!(links[0].snippet.ends_with('…'));
        assert!(links[0].snippet.chars().count() <= MAX_SNIPPET_CHARS + 1);
    }

    #[test]
    fn a_note_merges_frontmatter_and_inline_tags() {
        let note = extract_note(
            "/w/a.md",
            "---\ntitle: Note\ntags: [Work, ideas]\n---\n\nbody #Work/Urgent and #42\n",
        );
        assert_eq!(note.tags, vec!["ideas", "work", "work/urgent"]);
        assert_eq!(note.title.as_deref(), Some("Note"));
        assert_eq!(note.fields.get("title").map(String::as_str), Some("Note"));
        assert!(!note.fields.contains_key("tags"));
    }

    #[test]
    fn frontmatter_tags_do_not_leak_into_the_inline_scan() {
        // The body scan starts after the closing fence, so a `#` in the block
        // is not read as a tag.
        let note = extract_note("/w/a.md", "---\nnote: see #notatag\n---\n\nbody #real\n");
        assert_eq!(note.tags, vec!["real"]);
    }

    #[test]
    fn a_note_without_frontmatter_still_indexes() {
        let note = extract_note("/w/a.md", "# Title\n\nlinks to [[Other]] #tag\n");
        assert_eq!(note.tags, vec!["tag"]);
        assert!(note.title.is_none());
        assert!(note.fields.is_empty());
        assert_eq!(note.links.len(), 1);
    }

    #[test]
    fn aliases_are_kept_for_the_resolver() {
        let note = extract_note("/w/a.md", "---\naliases: [Alt, Second]\n---\n");
        assert_eq!(note.aliases, vec!["Alt", "Second"]);
        assert_eq!(
            note.fields.get("aliases").map(String::as_str),
            Some("Alt, Second")
        );
    }

    #[test]
    fn an_oversized_block_leaves_the_note_indexed_for_inline_tags() {
        let content = format!("---\nbig: {}\n---\nbody #kept\n", "x".repeat(9000));
        let note = extract_note("/w/a.md", &content);
        assert!(note.fields.is_empty());
        assert_eq!(note.tags, vec!["kept"]);
    }
}
