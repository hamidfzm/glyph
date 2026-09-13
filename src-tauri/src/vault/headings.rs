//! Headings, their GitHub-style slugs, and the section under one heading,
//! ported rule for rule from `src/lib/markdownHeadings.ts` and
//! `src/lib/headingSection.ts`. The renderer keeps those for embeds, which
//! slice content it has already loaded; `fixtures/vault-headings.json` holds
//! both sides to the same answers, and both split lines on CRLF, CR and LF.

use std::cmp::Ordering;

use serde::Serialize;

use super::slug_table::STRIPPED;

#[derive(Debug, PartialEq, Serialize)]
pub(crate) struct Heading {
    pub level: u8,
    pub text: String,
    /// 1-based, like a link's line.
    pub line: u32,
}

/// JavaScript's `\s`, which is also what `trim()` removes: Unicode White_Space
/// plus U+FEFF, minus U+0085.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// What JavaScript's `.` refuses to match.
fn is_js_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `^\s{0,3}(```+|~~~+)`: the fence character when `line` opens or closes a
/// fence.
fn fence_marker(line: &str) -> Option<char> {
    let rest = line.trim_start_matches(is_js_space);
    if line[..line.len() - rest.len()].chars().count() > 3 {
        return None;
    }
    ["```", "~~~"]
        .into_iter()
        .find(|run| rest.starts_with(run))
        .and_then(|run| run.chars().next())
}

/// Fenced code across lines: whether `line` opens, closes or sits inside a
/// fence, which closes only on the character that opened it.
pub(super) struct Fences(Option<char>);

impl Fences {
    pub(super) fn new() -> Self {
        Fences(None)
    }

    pub(super) fn skip(&mut self, line: &str) -> bool {
        if let Some(marker) = fence_marker(line) {
            match self.0 {
                None => self.0 = Some(marker),
                Some(open) if open == marker => self.0 = None,
                Some(_) => {}
            }
            return true;
        }
        self.0.is_some()
    }
}

/// The lines of `text` as `split(/\r\n|\r|\n/)` yields them, without the empty
/// piece a final terminator leaves, as `str::lines` does.
pub(crate) fn js_lines(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        let end = rest.find(['\r', '\n']).unwrap_or(rest.len());
        let line = &rest[..end];
        let after = &rest[end..];
        rest = after
            .strip_prefix("\r\n")
            .or_else(|| after.get(1..))
            .unwrap_or("");
        Some(line)
    })
}

/// `^(#{1,6})\s+`, then the text trimmed at the end before it is checked for
/// a line terminator, which `.` stops at: a trailing U+2028 is whitespace, one
/// inside the text is no heading.
fn atx(line: &str) -> Option<(u8, String)> {
    let level = line.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let after = &line[level..];
    let rest = after.trim_start_matches(is_js_space);
    if rest.len() == after.len() {
        return None;
    }
    let content = rest.trim_end_matches(is_js_space);
    if content.contains(is_js_line_terminator) {
        return None;
    }
    Some((level as u8, heading_text(content)))
}

/// A closing run of `#` goes when it is the whole text or whitespace separates
/// it from the text, so `C#` keeps its hash.
fn heading_text(content: &str) -> String {
    let before_run = content.trim_end_matches('#');
    let closed = before_run.len() < content.len()
        && (before_run.is_empty() || before_run.ends_with(is_js_space));
    let text = if closed { before_run } else { content };
    text.trim_matches(is_js_space).to_string()
}

/// Every ATX heading from line `body_start` on, skipping fenced code. A fence
/// closes only on the character that opened it.
pub(crate) fn parse_headings(content: &str, body_start: usize) -> Vec<Heading> {
    let mut headings = Vec::new();
    let mut fences = Fences::new();
    for (idx, line) in js_lines(content).enumerate().skip(body_start) {
        if fences.skip(line) {
            continue;
        }
        if let Some((level, text)) = atx(line) {
            headings.push(Heading {
                level,
                text,
                line: (idx + 1) as u32,
            });
        }
    }
    headings
}

/// github-slugger's stateless `slug()`: lowercase, drop what its regex strips,
/// and turn each space into `-`. No `-1` suffix, which only the stateful
/// slugger adds.
pub(crate) fn slug(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|&c| !is_stripped(c))
        .map(|c| if c == ' ' { '-' } else { c })
        .collect()
}

fn is_stripped(c: char) -> bool {
    let point = u32::from(c);
    STRIPPED
        .binary_search_by(|&(low, high)| {
            if high < point {
                Ordering::Less
            } else if low > point {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        })
        .is_ok()
}

fn names_heading(heading: &str, wanted: &str) -> bool {
    let (heading, wanted) = (
        heading.trim_matches(is_js_space),
        wanted.trim_matches(is_js_space),
    );
    heading.to_lowercase() == wanted.to_lowercase() || slug(heading) == slug(wanted)
}

/// The section under the first heading named `wanted`, by text or by slug: its
/// heading line up to the next heading of the same or a higher level, with the
/// trailing blank lines dropped.
pub(crate) fn section(content: &str, body_start: usize, wanted: &str) -> Option<String> {
    let headings = parse_headings(content, body_start);
    let start = headings
        .iter()
        .position(|h| names_heading(&h.text, wanted))?;
    let first = headings[start].line as usize - 1;
    let end = headings[start + 1..]
        .iter()
        .find(|h| h.level <= headings[start].level)
        .map_or(usize::MAX, |h| h.line as usize - 1);
    let lines: Vec<&str> = js_lines(content).skip(first).take(end - first).collect();
    Some(lines.join("\n").trim_end_matches(is_js_space).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(md: &str) -> Vec<String> {
        parse_headings(md, 0).into_iter().map(|h| h.text).collect()
    }

    #[test]
    fn a_heading_carries_its_level_text_and_line() {
        assert_eq!(
            parse_headings("# One\ntext\n## Two", 0),
            vec![
                Heading {
                    level: 1,
                    text: "One".into(),
                    line: 1
                },
                Heading {
                    level: 2,
                    text: "Two".into(),
                    line: 3
                },
            ]
        );
    }

    #[test]
    fn fenced_lines_are_not_headings() {
        assert_eq!(
            texts("# Title\n```python\n# not a heading\n```\n## Real"),
            ["Title", "Real"]
        );
        assert_eq!(
            texts("# Title\n~~~\n# nope\n~~~\n## Real"),
            ["Title", "Real"]
        );
        // A tilde line does not close a backtick fence.
        assert_eq!(texts("```\n~~~\n# still code\n```\n# Real"), ["Real"]);
        // Four spaces of indent is not a fence, so the heading after it counts.
        assert_eq!(texts("    ```\n# Real"), ["Real"]);
        assert_eq!(texts("   ```\n# fenced\n```\n# Real"), ["Real"]);
    }

    #[test]
    fn a_closing_run_goes_only_after_whitespace() {
        assert_eq!(texts("# Title #"), ["Title"]);
        assert_eq!(texts("## Closed  ##  "), ["Closed"]);
        assert_eq!(texts("## Language C#"), ["Language C#"]);
        assert_eq!(texts("# #"), [""]);
    }

    #[test]
    fn javascript_whitespace_rules_hold() {
        // A heading needs whitespace after its hashes, and at most six of them.
        assert!(texts("#tag\n####### seven\n##").is_empty());
        // `\s+` then an empty `(.*)`: a heading with no text still counts.
        assert_eq!(texts("## "), [""]);
        // U+FEFF is JavaScript whitespace and U+0085 is not.
        assert_eq!(texts("#\u{feff}Bom"), ["Bom"]);
        assert!(texts("#\u{85}Nel").is_empty());
        // `.` stops at a line separator, so the whole line fails; one at the
        // end is whitespace, trimmed before the check.
        assert!(texts("# a\u{2028}b").is_empty());
        assert_eq!(texts("# a\u{2028}"), ["a"]);
        // Leading indentation is not allowed.
        assert!(texts(" # indented").is_empty());
    }

    #[test]
    fn the_frontmatter_block_is_skipped_by_line() {
        let md = "---\n# yaml comment\n---\n# Body";
        let headings = parse_headings(md, 3);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].line, 4);
    }

    #[test]
    fn slugs_follow_github_slugger() {
        assert_eq!(slug("My Heading"), "my-heading");
        assert_eq!(slug("Recipes & Tips!"), "recipes--tips");
        assert_eq!(slug("Café au lait"), "café-au-lait");
        assert_eq!(slug("snake_case-and-dash"), "snake_case-and-dash");
        assert_eq!(slug("Launch 🚀 Plan"), "launch--plan");
    }

    const DOC: &str =
        "# Intro\ntop matter\n\n## Recipes\npasta\n\n### Sauce\ntomato\n\n## Notes\nfooter\n";

    #[test]
    fn a_section_runs_to_the_next_heading_at_its_level_or_above() {
        assert_eq!(
            section(DOC, 0, "Recipes").as_deref(),
            Some("## Recipes\npasta\n\n### Sauce\ntomato")
        );
        assert_eq!(
            section(DOC, 0, "Sauce").as_deref(),
            Some("### Sauce\ntomato")
        );
        assert_eq!(
            section(DOC, 0, "Notes").as_deref(),
            Some("## Notes\nfooter")
        );
    }

    #[test]
    fn a_section_is_found_by_text_or_by_slug() {
        assert!(section(DOC, 0, "recipes").is_some());
        assert_eq!(
            section("## My Heading\nbody", 0, "my-heading").as_deref(),
            Some("## My Heading\nbody")
        );
        assert_eq!(section(DOC, 0, "Nope"), None);
    }

    #[test]
    fn a_fenced_heading_has_no_section() {
        let md = "## Real\ntext\n```\n## Fake\n```\nmore";
        assert_eq!(section(md, 0, "Fake"), None);
        assert_eq!(section(md, 0, "Real").as_deref(), Some(md));
    }

    #[test]
    fn a_cr_only_note_has_its_headings() {
        let md = "# One\rtext\r## Two\rbody";
        assert_eq!(texts(md), ["One", "Two"]);
        assert_eq!(section(md, 0, "Two").as_deref(), Some("## Two\nbody"));
    }

    #[test]
    fn a_crlf_note_has_its_headings() {
        let md = "# One\r\ntext\r\n## Two\r\nbody\r\n";
        assert_eq!(texts(md), ["One", "Two"]);
        assert_eq!(section(md, 0, "Two").as_deref(), Some("## Two\nbody"));
    }
}
