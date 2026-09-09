//! Tag rules for the vault index: what counts as a tag in note text, how a
//! written tag normalizes, and how tags roll up into counts.

/// Note content is untrusted and every tag reaches the frontend, so a single
/// crafted `a/a/a/…` tag can't expand into thousands of tree levels.
pub const MAX_TAG_CHARS: usize = 64;
/// Bounds the inline scan only. Frontmatter tags arrive inside the 8 KB block,
/// which bounds them already.
pub const MAX_INLINE_TAGS_PER_FILE: usize = 100;

/// `#Project/Alpha` and `project/alpha` are the same tag. The separator is
/// collapsed and trimmed so `work/` and `work//urgent` can't open a blank
/// level in the tag tree.
pub(crate) fn normalize_tag(tag: &str) -> String {
    let without_hash = tag.trim().trim_start_matches('#');
    let lowered = without_hash.to_lowercase();

    let mut out = String::with_capacity(lowered.len());
    let mut last_was_sep = false;
    for c in lowered.chars() {
        if c == '/' {
            if !last_was_sep {
                out.push(c);
            }
            last_was_sep = true;
            continue;
        }
        last_was_sep = false;
        out.push(c);
    }
    out.trim_matches('/').to_string()
}

/// Add every tag in `raw` to `into`. A plain scalar (`tags: work, ideas`)
/// reaches the index as one string, so it is split the way Obsidian does
/// instead of indexing "work, ideas" as a single tag.
pub(crate) fn add_tags(raw: &str, into: &mut Vec<String>) {
    for part in raw.split([',', ' ', '\t', '\n', '\r']) {
        let tag = normalize_tag(part);
        if !tag.is_empty() && tag.chars().count() <= MAX_TAG_CHARS && !into.contains(&tag) {
            into.push(tag);
        }
    }
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// Inline `#tag` tokens in one line of body text, lowercased. A tag opens at
/// the start of a line or after whitespace, so `mid#word` is not one.
fn push_line_tags(line: &str, out: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '#' || (i > 0 && !chars[i - 1].is_whitespace()) {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut end = start;
        while end < chars.len() && is_tag_char(chars[end]) {
            end += 1;
        }
        let tag: String = chars[start..end].iter().collect();
        // A digits-only run is an issue reference (`#42`), not a tag.
        let usable = !tag.is_empty()
            && tag.chars().count() <= MAX_TAG_CHARS
            && tag.chars().any(|c| !c.is_ascii_digit());
        if usable {
            out.push(tag.to_lowercase());
        }
        i = end;
    }
}

/// Inline tags across a note body, sorted, deduplicated, and capped. `body` is
/// the note's lines with any frontmatter block already skipped.
pub fn inline_tags<'a>(body: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in body {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        push_line_tags(line, &mut tags);
    }
    tags.sort();
    tags.dedup();
    tags.truncate(MAX_INLINE_TAGS_PER_FILE);
    tags
}

/// `project/glyph/ui` also belongs to `project/glyph` and to `project`.
pub(crate) fn with_ancestors(tag: &str) -> Vec<String> {
    let parts: Vec<&str> = tag.split('/').collect();
    (1..=parts.len()).map(|i| parts[..i].join("/")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_hashes_and_lowercases() {
        assert_eq!(normalize_tag("  #Project  "), "project");
        assert_eq!(normalize_tag("##Deep"), "deep");
        assert_eq!(normalize_tag("Work/Urgent"), "work/urgent");
    }

    #[test]
    fn normalize_collapses_and_trims_separators() {
        assert_eq!(normalize_tag("#work//urgent"), "work/urgent");
        assert_eq!(normalize_tag("#work/"), "work");
        assert_eq!(normalize_tag("#/work/"), "work");
        assert_eq!(normalize_tag("#"), "");
        assert_eq!(normalize_tag("///"), "");
    }

    #[test]
    fn add_tags_splits_a_plain_scalar() {
        let mut out = Vec::new();
        add_tags("work, ideas  drafts", &mut out);
        assert_eq!(out, vec!["work", "ideas", "drafts"]);
    }

    #[test]
    fn add_tags_drops_empty_and_oversized_entries() {
        let mut out = Vec::new();
        add_tags(&format!("ok, {}", "x".repeat(MAX_TAG_CHARS + 1)), &mut out);
        add_tags("  ,  ", &mut out);
        assert_eq!(out, vec!["ok"]);

        let mut exact = Vec::new();
        add_tags(&"y".repeat(MAX_TAG_CHARS), &mut exact);
        assert_eq!(exact.len(), 1);
    }

    #[test]
    fn add_tags_does_not_repeat_a_tag() {
        let mut out = Vec::new();
        add_tags("work", &mut out);
        add_tags("#Work", &mut out);
        assert_eq!(out, vec!["work"]);
    }

    #[test]
    fn inline_tags_ignore_fenced_code() {
        let body = "before #kept\n```\n#fenced\n```\nafter #also\n";
        assert_eq!(inline_tags(body.lines()), vec!["also", "kept"]);
    }

    #[test]
    fn inline_tags_ignore_issue_references_and_mid_word_hashes() {
        let body = "closes #42 for mid#word but keeps #real and #v2\n";
        assert_eq!(inline_tags(body.lines()), vec!["real", "v2"]);
    }

    #[test]
    fn inline_tags_keep_nesting_and_lowercase() {
        let body = "#Work/Urgent and #work/urgent\n";
        assert_eq!(inline_tags(body.lines()), vec!["work/urgent"]);
    }

    #[test]
    fn inline_tags_stop_at_the_per_file_cap() {
        let body: String = (0..MAX_INLINE_TAGS_PER_FILE + 20)
            .map(|i| format!("#tag{i:04}\n"))
            .collect();
        assert_eq!(inline_tags(body.lines()).len(), MAX_INLINE_TAGS_PER_FILE);
    }

    #[test]
    fn inline_tags_reject_a_run_over_the_character_cap() {
        let body = format!("#{} #short\n", "z".repeat(MAX_TAG_CHARS + 1));
        assert_eq!(inline_tags(body.lines()), vec!["short"]);
    }

    #[test]
    fn ancestors_expand_every_level() {
        assert_eq!(with_ancestors("a/b/c"), vec!["a", "a/b", "a/b/c"]);
        assert_eq!(with_ancestors("solo"), vec!["solo"]);
    }
}
