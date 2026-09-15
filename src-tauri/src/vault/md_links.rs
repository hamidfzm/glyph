//! Inline markdown the link scan has to see through: code spans, which hold no
//! links, and the relative destinations of `[text](dest)` and `![alt](dest)`,
//! which a move has to recompute.

use std::ops::Range;

/// Byte ranges of the code spans on one line: a backtick run up to the next run
/// of the same length. A run that never closes is literal text.
// ponytail: one line at a time, so a code span broken across lines is missed.
pub(super) fn code_spans(line: &str) -> Vec<Range<usize>> {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let open = backtick_run(bytes, i);
        let mut j = i + open;
        let mut close = None;
        while j < bytes.len() {
            if bytes[j] != b'`' {
                j += 1;
                continue;
            }
            let run = backtick_run(bytes, j);
            if run == open {
                close = Some(j + run);
                break;
            }
            j += run;
        }
        match close {
            Some(end) => {
                spans.push(i..end);
                i = end;
            }
            None => i += open,
        }
    }
    spans
}

fn backtick_run(bytes: &[u8], start: usize) -> usize {
    bytes[start..].iter().take_while(|&&b| b == b'`').count()
}

pub(super) fn in_spans(spans: &[Range<usize>], at: usize) -> bool {
    spans.iter().any(|span| span.contains(&at))
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
pub(super) fn relative_destinations(
    line: &str,
    code: &[Range<usize>],
) -> Vec<(String, Range<usize>)> {
    let bytes = line.as_bytes();
    let mut found = Vec::new();
    let mut open_brackets = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if in_spans(code, i) {
            i += 1;
            continue;
        }
        match bytes[i] {
            b'\\' => i += 1,
            b'[' => open_brackets += 1,
            b']' if open_brackets > 0 => {
                open_brackets -= 1;
                if bytes.get(i + 1) == Some(&b'(') {
                    if let Some((span, end)) = destination(line, i + 2) {
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

/// The destination starting at `start`, just past `](`, and the index after the
/// closing `)`. `None` when no `)` closes it, which makes it plain text.
fn destination(line: &str, start: usize) -> Option<(Range<usize>, usize)> {
    let bytes = line.as_bytes();
    let mut i = skip_blanks(bytes, start);
    let span = if bytes.get(i) == Some(&b'<') {
        let begin = i + 1;
        let close = begin + line[begin..].find(['<', '>'])?;
        if bytes[close] != b'>' {
            return None;
        }
        i = close + 1;
        begin..close
    } else {
        let begin = i;
        let mut depth = 0usize;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => i += 1,
                b'(' => depth += 1,
                b')' if depth == 0 => break,
                b')' => depth -= 1,
                b if b.is_ascii_whitespace() => break,
                _ => {}
            }
            i += 1;
        }
        i = i.min(bytes.len());
        begin..i
    };
    i = skip_blanks(bytes, i);
    if let Some(&quote) = bytes.get(i).filter(|&&b| b == b'"' || b == b'\'') {
        i += 1 + bytes.get(i + 1..)?.iter().position(|&b| b == quote)? + 1;
        i = skip_blanks(bytes, i);
    }
    (bytes.get(i) == Some(&b')')).then_some((span, i + 1))
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
        relative_destinations(line, &code_spans(line))
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
}
