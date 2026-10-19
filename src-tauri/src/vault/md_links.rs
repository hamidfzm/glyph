//! Inline markdown the link scan has to see through: code spans, which hold no
//! links, and the relative destinations of `[text](dest)` and `![alt](dest)`,
//! which a move has to recompute.
//!
//! Every pass here is linear in the line. Note content is untrusted and a line
//! can be as long as the file cap allows, so a scan that restarts from each
//! candidate (one `](` per three bytes, say) would take minutes on one file.

use std::collections::HashMap;
use std::ops::Range;

/// Byte ranges of the code spans on one line: a backtick run up to the next run
/// of the same length. A run that never closes is literal text.
// ponytail: one line at a time, so a code span broken across lines is missed.
pub(super) fn code_spans(line: &str) -> Vec<Range<usize>> {
    let runs = backtick_runs(line.as_bytes());
    let closers = next_run_of_same_length(&runs);
    let mut spans = Vec::new();
    let mut run = 0;
    while run < runs.len() {
        match closers[run] {
            Some(close) => {
                spans.push(runs[run].start..runs[close].end);
                run = close + 1;
            }
            None => run += 1,
        }
    }
    spans
}

/// Every maximal run of backticks, in order.
fn backtick_runs(bytes: &[u8]) -> Vec<Range<usize>> {
    let mut runs = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let len = bytes[i..].iter().take_while(|&&b| b == b'`').count();
        runs.push(i..i + len);
        i += len;
    }
    runs
}

/// For each run, the index of the next run of the same length, which is the
/// one that closes it when it opens a span.
fn next_run_of_same_length(runs: &[Range<usize>]) -> Vec<Option<usize>> {
    let mut next = vec![None; runs.len()];
    let mut latest_by_length: HashMap<usize, usize> = HashMap::new();
    for (index, run) in runs.iter().enumerate().rev() {
        next[index] = latest_by_length.insert(run.len(), index);
    }
    next
}

/// Answers "is this byte inside a code span" for positions asked in increasing
/// order, each in constant time on average. The spans come sorted and disjoint
/// from [`code_spans`], so the cursor only ever moves forward.
pub(super) struct SpanCursor<'a> {
    spans: &'a [Range<usize>],
    next: usize,
}

impl<'a> SpanCursor<'a> {
    pub(super) fn new(spans: &'a [Range<usize>]) -> Self {
        Self { spans, next: 0 }
    }

    /// The span holding `at`, if any. `at` must not be smaller than the
    /// position asked before.
    pub(super) fn span_at(&mut self, at: usize) -> Option<&'a Range<usize>> {
        while self.spans.get(self.next).is_some_and(|span| span.end <= at) {
            self.next += 1;
        }
        self.spans.get(self.next).filter(|span| span.contains(&at))
    }
}

/// `isRelativeLocalHref` in `src/lib/relativePath.ts`: a local path rather than
/// a URL, an in-document anchor, or an absolute path.
fn is_relative_local(dest: &str) -> bool {
    if dest.is_empty() || dest.starts_with(['#', '/', '\\']) {
        return false;
    }
    let has_scheme = dest.split_once(':').is_some_and(|(scheme, _)| {
        scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
    });
    !has_scheme
}

/// The relative destinations of the inline links and images on one line, each
/// with its byte range: inside `<...>` when bracketed, otherwise as written.
/// Stops after `limit` of them.
pub(super) fn relative_destinations(
    line: &str,
    code: &[Range<usize>],
    limit: usize,
) -> Vec<(String, Range<usize>)> {
    let bytes = line.as_bytes();
    let mut found = Vec::new();
    let mut code = SpanCursor::new(code);
    let mut destinations = Destinations::default();
    let mut open_brackets = 0usize;
    let mut i = 0;
    while i < bytes.len() && found.len() < limit {
        if let Some(span) = code.span_at(i) {
            i = span.end;
            continue;
        }
        match bytes[i] {
            b'\\' => i += 1,
            b'[' => open_brackets += 1,
            b']' if open_brackets > 0 => {
                open_brackets -= 1;
                if bytes.get(i + 1) == Some(&b'(') {
                    if let Some((span, end)) = destinations.at(line, i + 2) {
                        if is_relative_local(&line[span.clone()]) {
                            found.push((line[span.clone()].to_string(), span));
                        }
                        i = end;
                        continue;
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    found
}

/// The destination scans of one line. A `](` whose destination never closes is
/// plain text, and the scan goes on from the next byte, so what one failed
/// scan read is read again by the candidates inside it. Two memos keep that
/// linear: where a bare destination starting at any byte ends, computed once
/// for the whole line, and the last search for the closing `)`, which every
/// candidate ending at the same whitespace repeats.
#[derive(Default)]
struct Destinations {
    bare_ends: Option<Vec<usize>>,
    last_close: Option<(usize, Option<usize>)>,
}

impl Destinations {
    /// The destination starting at `start`, just past `](`, and the index
    /// after the closing `)`. `None` when no `)` closes it.
    fn at(&mut self, line: &str, start: usize) -> Option<(Range<usize>, usize)> {
        let bytes = line.as_bytes();
        let i = skip_blanks(bytes, start);
        let (span, after) = if bytes.get(i) == Some(&b'<') {
            let begin = i + 1;
            let close = begin + line[begin..].find(['<', '>'])?;
            if bytes[close] != b'>' {
                return None;
            }
            (begin..close, close + 1)
        } else {
            let ends = self.bare_ends.get_or_insert_with(|| bare_ends(bytes));
            (i..ends[i], ends[i])
        };
        let end = match self.last_close {
            Some((at, end)) if at == after => end,
            _ => {
                let end = closing_paren(bytes, after);
                self.last_close = Some((after, end));
                end
            }
        };
        Some((span, end?))
    }
}

/// Where the bare destination starting at each byte ends: at the first
/// whitespace, at the `)` that closes no `(` read since the start, or at the
/// end of the line. Built right to left, since where a scan ends depends only
/// on what follows.
fn bare_ends(bytes: &[u8]) -> Vec<usize> {
    let len = bytes.len();
    let mut ends = vec![len; len + 1];
    for i in (0..len).rev() {
        ends[i] = match bytes[i] {
            b'\\' => ends[(i + 2).min(len)],
            b'(' => {
                // Past the parenthesis the scan ends where one from the next
                // byte would, unless that is the `)` closing this one, which
                // this scan steps over.
                let inner = ends[i + 1];
                if bytes.get(inner) == Some(&b')') {
                    ends[inner + 1]
                } else {
                    inner
                }
            }
            b')' => i,
            b if b.is_ascii_whitespace() => i,
            _ => ends[i + 1],
        };
    }
    ends
}

/// The index after the `)` that closes a destination ending at `after`, past
/// blanks and an optional quoted title. `None` when something else is there.
fn closing_paren(bytes: &[u8], after: usize) -> Option<usize> {
    let mut i = skip_blanks(bytes, after);
    if let Some(&quote) = bytes.get(i).filter(|&&b| b == b'"' || b == b'\'') {
        i += 1 + bytes.get(i + 1..)?.iter().position(|&b| b == quote)? + 1;
        i = skip_blanks(bytes, i);
    }
    (bytes.get(i) == Some(&b')')).then_some(i + 1)
}

fn skip_blanks(bytes: &[u8], start: usize) -> usize {
    let blanks = bytes.get(start..).map_or(0, |rest| {
        rest.iter()
            .take_while(|&&b| b == b' ' || b == b'\t')
            .count()
    });
    start + blanks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn destinations(line: &str) -> Vec<String> {
        relative_destinations(line, &code_spans(line), usize::MAX)
            .into_iter()
            .map(|(dest, span)| {
                assert_eq!(&line[span], dest);
                dest
            })
            .collect()
    }

    #[test]
    fn code_spans_close_on_a_run_of_the_same_length() {
        let line = "a `x` b ``y ` z`` c ```open";
        let spans: Vec<&str> = code_spans(line).into_iter().map(|s| &line[s]).collect();
        assert_eq!(spans, ["`x`", "``y ` z``"]);
    }

    #[test]
    fn links_and_images_yield_their_destinations() {
        assert_eq!(
            destinations("see [a](Notes/A.md) and ![pic](../img.png) here"),
            ["Notes/A.md", "../img.png"]
        );
    }

    #[test]
    fn an_image_inside_a_link_yields_both() {
        assert_eq!(
            destinations("[![pic](pic.png)](Page.md)"),
            ["pic.png", "Page.md"]
        );
    }

    #[test]
    fn bracketed_destinations_and_titles_are_handled() {
        assert_eq!(
            destinations(r#"[a](<My Note.md> "title") [b](b.md 'x') [c](c(1).md)"#),
            ["My Note.md", "b.md", "c(1).md"]
        );
    }

    #[test]
    fn urls_anchors_and_absolute_paths_are_not_relative() {
        assert!(destinations(
            "[a](https://x.io) [b](#top) [c](/abs.md) [d](mailto:a@b) [e](C:\\x.md) [f]()"
        )
        .is_empty());
        assert_eq!(destinations("[a](a.md#Heading)"), ["a.md#Heading"]);
    }

    #[test]
    fn code_spans_and_unclosed_links_hold_no_destination() {
        assert!(destinations("`[a](a.md)` and [b](b.md and x](y.md)").is_empty());
        assert!(destinations(r"\[a](a.md)").is_empty());
        assert!(destinations("[a](<x<y>)").is_empty());
    }

    #[test]
    fn a_link_inside_a_failed_destination_is_still_found() {
        // CommonMark reads `[a](x` as text and `[c](d.md)` as a link.
        assert_eq!(destinations("[a](x[c](d.md)"), ["d.md"]);
        assert_eq!(destinations("[a](((x) [b](y.md)"), ["y.md"]);
        assert_eq!(destinations(r"[a](x\) [b](y.md)"), ["y.md"]);
    }

    #[test]
    fn the_destination_limit_stops_the_scan() {
        let line = "[a](a.md) [b](b.md) [c](c.md)";
        let found = relative_destinations(line, &[], 2);
        assert_eq!(found.len(), 2);
        assert_eq!(found[1].0, "b.md");
    }

    #[test]
    fn a_span_cursor_answers_in_order() {
        let spans = [2..4, 6..7];
        let mut cursor = SpanCursor::new(&spans);
        assert_eq!(cursor.span_at(0), None);
        assert_eq!(cursor.span_at(2), Some(&(2..4)));
        assert_eq!(cursor.span_at(3), Some(&(2..4)));
        assert_eq!(cursor.span_at(4), None);
        assert_eq!(cursor.span_at(6), Some(&(6..7)));
        assert_eq!(cursor.span_at(9), None);
    }

    /// Every shape that once made one long line quadratic, each a megabyte:
    /// a run of `](` whose destinations never close, code spans beside links,
    /// and increasingly long backtick runs that never close.
    #[test]
    fn a_megabyte_line_of_each_hostile_shape_scans_in_bounded_time() {
        let mib = 1024 * 1024;
        let mut lines = vec![
            "[](".repeat(mib / 3),
            "`a` [b](c.md)".repeat(mib / 13),
            "[](<a> ".repeat(mib / 7),
            format!("{}{}", "[](".repeat(mib / 6), " ".repeat(mib / 2)),
            format!("{}{}", "[](".repeat(mib / 6), "\"".repeat(mib / 2)),
        ];
        let mut backticks = String::new();
        for run in 1.. {
            if backticks.len() >= mib {
                break;
            }
            backticks.push_str(&"`".repeat(run));
            backticks.push('a');
        }
        lines.push(backticks);

        for line in &lines {
            let started = std::time::Instant::now();
            let spans = code_spans(line);
            relative_destinations(line, &spans, usize::MAX);
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "a hostile line took {:?}",
                started.elapsed()
            );
        }
    }
}
