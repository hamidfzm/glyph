//! Headings, their GitHub-style slugs, and the section under one heading,
//! ported rule for rule from `src/lib/markdownHeadings.ts` and
//! `src/lib/headingSection.ts`. The renderer keeps those for embeds, which
//! slice content it has already loaded; `fixtures/vault-headings.json` holds
//! both sides to the same answers, and both split lines on CRLF, CR and LF.

use std::cmp::Ordering;
use std::ops::Range;

use serde::Serialize;

use super::slug_table::STRIPPED;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Heading {
    pub level: u8,
    pub text: String,
    /// 1-based, like a link's line.
    pub line: u32,
}

/// JavaScript's `\s`, which is also what `trim()` removes: Unicode White_Space
/// plus U+FEFF, minus U+0085.
pub(super) fn is_js_space(c: char) -> bool {
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

/// Fenced code the way CommonMark reads it, for a caller about to write.
/// [`Fences`] is the renderer's embed slicer, which matches on the fence
/// character alone; here a fence closes only on a bare run of that character
/// at least as long as the one that opened it. Any indent counts, since a
/// fence inside a nested list item sits deeper than three columns.
pub(super) struct StrictFences(Option<(char, usize)>);

impl StrictFences {
    pub(super) fn new() -> Self {
        StrictFences(None)
    }

    pub(super) fn skip(&mut self, line: &str) -> bool {
        let text = line.trim_start_matches(is_js_space);
        let marker = text.chars().next().filter(|c| matches!(c, '`' | '~'));
        let run = marker.map_or(0, |m| text.chars().take_while(|&c| c == m).count());
        let after = &text[run..];
        match (self.0, marker) {
            (None, Some(marker)) if run >= 3 => {
                // A backtick in the info string makes the run inline code.
                let opens = marker == '~' || !after.contains('`');
                self.0 = opens.then_some((marker, run));
                opens
            }
            (None, _) => false,
            (Some((open, length)), Some(marker)) => {
                let bare = after.trim_matches(is_js_space).is_empty();
                if marker == open && run >= length && bare {
                    self.0 = None;
                }
                true
            }
            (Some(_), None) => true,
        }
    }
}

/// The lines of `text` as `split(/\r\n|\r|\n/)` yields them, without the empty
/// piece a final terminator leaves, as `str::lines` does.
pub(crate) fn js_lines(text: &str) -> impl Iterator<Item = &str> {
    js_line_starts(text).map(|(_, line)| line)
}

/// [`js_lines`], each with the byte it starts at. A line and its terminator
/// end where the next line starts, or where `text` does.
pub(crate) fn js_line_starts(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut at = 0;
    std::iter::from_fn(move || {
        let rest = &text[at..];
        if rest.is_empty() {
            return None;
        }
        let end = rest.find(['\r', '\n']).unwrap_or(rest.len());
        let terminator = match &rest[end..] {
            after if after.starts_with("\r\n") => 2,
            "" => 0,
            _ => 1,
        };
        let start = at;
        at += end + terminator;
        Some((start, &rest[..end]))
    })
}

/// The terminator `text` uses, judged by its first, for text added to it.
pub(crate) fn line_ending(text: &str) -> &'static str {
    match text.find(['\r', '\n']) {
        Some(at) if text[at..].starts_with("\r\n") => "\r\n",
        Some(at) if text[at..].starts_with('\r') => "\r",
        _ => "\n",
    }
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

/// Where one section's body sits in the note, in bytes.
#[derive(Debug, PartialEq)]
pub(crate) struct SectionSpan {
    pub heading: Heading,
    /// The body without the blank lines around it, through its last line's
    /// terminator. Empty, at the end of the heading line, for a section that
    /// holds nothing.
    pub body: Range<usize>,
    /// The 0-based line the section stops before.
    pub end_line: usize,
}

/// Every section whose heading is named `wanted`, each sliced as [`section`]
/// slices the first. A caller that changes a section has to know when the
/// name alone does not pick one.
pub(crate) fn section_spans(content: &str, body_start: usize, wanted: &str) -> Vec<SectionSpan> {
    let lines: Vec<(usize, &str)> = js_line_starts(content).collect();
    let start_of = |line: usize| lines.get(line).map_or(content.len(), |(start, _)| *start);
    let filled = |line: &usize| !lines[*line].1.trim_matches(is_js_space).is_empty();
    let headings = parse_headings(content, body_start);
    let mut spans = Vec::new();
    for (at, heading) in headings.iter().enumerate() {
        if !names_heading(&heading.text, wanted) {
            continue;
        }
        // A heading's 1-based line is the 0-based line after it.
        let first = heading.line as usize;
        let end = headings[at + 1..]
            .iter()
            .find(|next| next.level <= heading.level)
            .map_or(lines.len(), |next| next.line as usize - 1);
        let body = match ((first..end).find(filled), (first..end).rfind(filled)) {
            (Some(top), Some(bottom)) => start_of(top)..start_of(bottom + 1),
            _ => start_of(first)..start_of(first),
        };
        spans.push(SectionSpan {
            heading: heading.clone(),
            body,
            end_line: end,
        });
    }
    spans
}

/// The first line, 1-based, that puts the bounds of `span`'s section in doubt.
/// Sections are cut by the renderer's embed slicer, which follows only
/// unindented `#` headings and matches fences by character. CommonMark also
/// reads a heading in a line indented by spaces or underlined with `=` or `-`,
/// and closes a fence by its length. A heading only one of the two readings
/// has, at the section's level or above, means a write would land on bounds
/// the rendered note does not have.
pub(crate) fn uncertain_line(content: &str, body_start: usize, span: &SectionSpan) -> Option<u32> {
    let heading_line = span.heading.line as usize - 1;
    let (mut loose, mut strict) = (Fences::new(), StrictFences::new());
    let mut above_is_text = false;
    // Through the heading that ends the section, which has to be one too.
    let lines = js_lines(content).enumerate().take(span.end_line + 1);
    // Fences carry over from every line above, so both are fed from the top.
    for (idx, line) in lines.skip(body_start) {
        let (code, strict_code) = (loose.skip(line), strict.skip(line));
        let text = line.trim_matches(is_js_space);
        let rule =
            !text.is_empty() && (text.chars().all(|c| c == '=') || text.chars().all(|c| c == '-'));
        // The level of a heading here that only one reading has.
        let disputed = match atx(line) {
            Some((level, _)) => (code != strict_code).then_some(level),
            None if strict_code => None,
            None if line.starts_with(' ') => atx(line.trim_start_matches(' ')).map(|found| found.0),
            None if rule && above_is_text => Some(if text.starts_with('=') { 1 } else { 2 }),
            None => None,
        };
        above_is_text = !strict_code && !text.is_empty() && !rule && atx(line).is_none();
        let moves_a_bound = match disputed {
            Some(_) if idx == heading_line => true,
            Some(level) => idx > heading_line && level <= span.heading.level,
            None => false,
        };
        if moves_a_bound {
            return Some(idx as u32 + 1);
        }
    }
    None
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

    fn bodies<'a>(md: &'a str, wanted: &str) -> Vec<&'a str> {
        section_spans(md, 0, wanted)
            .into_iter()
            .map(|span| &md[span.body])
            .collect()
    }

    #[test]
    fn a_section_body_is_spanned_without_the_blank_lines_around_it() {
        // The subsection belongs to its parent, as it does when read.
        assert_eq!(bodies(DOC, "Recipes"), ["pasta\n\n### Sauce\ntomato\n"]);
        assert_eq!(bodies(DOC, "sauce"), ["tomato\n"]);
        assert_eq!(bodies(DOC, "Notes"), ["footer\n"]);
        assert!(bodies(DOC, "Nope").is_empty());

        let spaced = "# A\r\n\r\n  \r\nbody\r\n\r\n# B\r\n";
        assert_eq!(bodies(spaced, "A"), ["body\r\n"]);
        // The last line of the note has no terminator to take.
        assert_eq!(bodies("# A\nlast", "A"), ["last"]);
    }

    #[test]
    fn an_empty_section_spans_nothing_just_past_its_heading() {
        for (md, at) in [
            ("# A\n# B\n", 4),
            ("# A\n\n\n# B\n", 4),
            ("# A", 3),
            ("# A\n", 4),
        ] {
            assert_eq!(section_spans(md, 0, "A")[0].body, at..at, "{md:?}");
        }
    }

    #[test]
    fn every_heading_that_shares_the_name_is_spanned() {
        let md = "# Mon\n## Tasks\none\n# Tue\n## Tasks\ntwo\n```\n## Tasks\n```\n";
        let spans = section_spans(md, 0, "tasks");
        let lines: Vec<u32> = spans.iter().map(|span| span.heading.line).collect();
        assert_eq!(lines, [2, 5]);
        // A fenced line that looks like a heading ends nothing.
        assert_eq!(&md[spans[1].body.clone()], "two\n```\n## Tasks\n```\n");
    }

    /// The line that puts the first section named `wanted` in doubt.
    fn doubt(md: &str, wanted: &str) -> Option<u32> {
        uncertain_line(md, 0, &section_spans(md, 0, wanted)[0])
    }

    #[test]
    fn a_heading_only_commonmark_reads_puts_the_section_in_doubt() {
        // An underlined heading the slicer runs straight through.
        let setext = "# Intro\ntext\n\nNext Chapter\n============\nbody\n\n# Last\n";
        assert_eq!(doubt(setext, "Intro"), Some(5));
        assert_eq!(doubt(setext, "Last"), None);
        assert_eq!(doubt("## A\ntext\n---\nmore\n", "A"), Some(3));
        // Indented, it is still a heading to CommonMark.
        assert_eq!(doubt("# A\ntext\n  # B\nmore\n", "A"), Some(3));

        // A deeper heading ends nothing, and a rule after a blank line is a
        // rule, as a table's own is.
        assert_eq!(doubt("# A\ntext\n---\nmore\n# B\n", "B"), None);
        assert_eq!(doubt("# A\nSub\n---\n  ## Deeper\n", "A"), None);
        assert_eq!(doubt("## A\ntext\n\n---\n\n| a |\n|---|\n", "A"), None);
        assert_eq!(doubt(DOC, "Recipes"), None);
    }

    #[test]
    fn a_fence_the_two_readings_close_differently_puts_the_section_in_doubt() {
        // Four backticks wrap a three-backtick block: the slicer takes the
        // comment inside for a heading.
        let nested = "# Guide\nintro\n\n````md\n```sh\n# install deps\n```\n````\n\ntail\n# Next\n";
        assert_eq!(doubt(nested, "Guide"), Some(6));
        // One three-backtick line inside leaves the slicer's fence open, so
        // it runs past every heading after.
        let lopsided = "# Guide\n````\n``` not a close\n````\n# Next\nbody\n";
        assert_eq!(doubt(lopsided, "Guide"), Some(5));
        // The section's own heading is code to CommonMark.
        assert_eq!(doubt(nested, "install deps"), Some(6));

        // Fences both readings agree on are no doubt, whatever they hold.
        let plain = "# A\n```\n# not a heading\n```\n~~~\n# nor this\n~~~\n# B\n";
        assert_eq!(doubt(plain, "A"), None);
        // Nor is one only CommonMark sees, while no heading sits inside it.
        assert_eq!(
            doubt(
                "# A\n- item\n\n      ```\n      code\n      ```\n# B\n",
                "A"
            ),
            None
        );
    }

    #[test]
    fn strict_fences_close_on_their_own_length_and_count_at_any_depth() {
        let code = |md: &str| -> Vec<bool> {
            let mut fences = StrictFences::new();
            js_lines(md).map(|line| fences.skip(line)).collect()
        };
        assert_eq!(code("a\n```\nb\n```\nc"), [false, true, true, true, false]);
        // A shorter run, or one with text after it, closes nothing.
        assert_eq!(
            code("````\n```\n```` x\n````\nc"),
            [true, true, true, true, false]
        );
        assert_eq!(code("~~~\n```\n~~~\nc"), [true, true, true, false]);
        // Deep inside a list it is still a fence.
        assert_eq!(
            code("        ```\n        b\n        ```"),
            [true, true, true]
        );
        // Backticks in the info string make it inline code, not a fence.
        assert_eq!(code("``` `x` ```\nb"), [false, false]);
        assert_eq!(code("``\nb"), [false, false]);
    }

    #[test]
    fn lines_start_where_the_one_before_ended() {
        let starts: Vec<(usize, &str)> = js_line_starts("a\r\nbb\rc\n\nd").collect();
        assert_eq!(starts, [(0, "a"), (3, "bb"), (6, "c"), (8, ""), (9, "d")]);
        assert_eq!(js_line_starts("").count(), 0);
        assert_eq!(line_ending("a\r\nb\n"), "\r\n");
        assert_eq!(line_ending("a\rb"), "\r");
        assert_eq!(line_ending("a\nb\r\n"), "\n");
        assert_eq!(line_ending("no terminator"), "\n");
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
