//! Per-note extraction: what one file contributes to the index.

use std::collections::BTreeMap;

use super::frontmatter::{parse_frontmatter, split_frontmatter};
use super::tags::{add_tags, inline_tags};

pub const MAX_SNIPPET_CHARS: usize = 200;

#[derive(Debug, PartialEq)]
pub(crate) struct Link {
    /// Target as written, with `|alias` and `#heading` removed.
    pub target: String,
    pub heading: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
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
        links: parse_links(content),
    }
}

/// Every `[[target]]` and `![[embed]]` outside fenced code, in source order.
fn parse_links(content: &str) -> Vec<Link> {
    let mut links = Vec::new();
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
        if let Some(link) = parse_link_inner(&inner) {
            out.push(Link {
                embed: i > 0 && chars[i - 1] == '!',
                line: line_number,
                snippet: snippet_for(line),
                ..link
            });
        }
        i = close + 2;
    }
}

/// Split `name#heading|alias` into its parts. `None` when no target survives.
fn parse_link_inner(inner: &str) -> Option<Link> {
    let (target_with_heading, alias) = match inner.split_once('|') {
        Some((target, alias)) => (target.trim(), alias.trim()),
        None => (inner.trim(), ""),
    };
    let (target, heading) = match target_with_heading.split_once('#') {
        Some((target, heading)) => (target.trim(), heading.trim()),
        None => (target_with_heading, ""),
    };
    if target.is_empty() {
        return None;
    }
    Some(Link {
        target: target.to_string(),
        heading: (!heading.is_empty()).then(|| heading.to_string()),
        alias: (!alias.is_empty()).then(|| alias.to_string()),
        embed: false,
        line: 0,
        snippet: String::new(),
    })
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

    fn targets(content: &str) -> Vec<String> {
        parse_links(content)
            .into_iter()
            .map(|link| link.target)
            .collect()
    }

    #[test]
    fn links_carry_target_heading_alias_and_line() {
        let links = parse_links("intro\nsee [[Target#Section|the alias]] here\n");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Target");
        assert_eq!(links[0].heading.as_deref(), Some("Section"));
        assert_eq!(links[0].alias.as_deref(), Some("the alias"));
        assert_eq!(links[0].line, 2);
        assert!(!links[0].embed);
        assert!(links[0].snippet.starts_with("see [[Target"));
    }

    #[test]
    fn an_exclamation_marks_an_embed() {
        let links = parse_links("![[Board]] and [[Plain]]\n");
        assert_eq!(links.len(), 2);
        assert!(links[0].embed);
        assert!(!links[1].embed);
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
    fn long_lines_are_truncated_in_the_snippet() {
        let line = format!("{}[[Target]]{}", "x".repeat(150), "y".repeat(150));
        let links = parse_links(&line);
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
