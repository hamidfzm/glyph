//! Setting or removing one frontmatter property without rewriting the rest.
//!
//! The parser gives no end positions, so an entry is taken by lines: from its
//! key to the line before the next key, less the comments and blank lines that
//! trail it. Only those lines are replaced. Nothing is trusted to that slicing
//! alone: the result is parsed again, and every other entry has to hold the
//! value it held before, or the edit is refused.

use yaml_rust2::scanner::TScalarStyle;

use super::frontmatter::{is_fence, sited_entries, split_frontmatter, Entry, Value};
use super::headings::line_ending;

/// One scalar to write.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Scalar {
    /// Text, quoted wherever YAML would read it as anything else.
    Text(String),
    /// A number or a boolean, written as it is.
    Bare(String),
}

impl Scalar {
    /// What the parser reads back, whichever way it was written.
    fn text(&self) -> &str {
        match self {
            Scalar::Text(text) | Scalar::Bare(text) => text,
        }
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum NewValue {
    Scalar(Scalar),
    List(Vec<Scalar>),
}

#[derive(Debug, PartialEq)]
pub(crate) struct PropertyEdit {
    pub content: String,
    /// Whether the note already held the key.
    pub existed: bool,
}

/// `content` with `key` set to `value`, or removed for `None`. `Ok(None)` when
/// that changes nothing. `content` carries no BOM.
pub(crate) fn set_property(
    content: &str,
    key: &str,
    value: Option<&NewValue>,
) -> Result<Option<PropertyEdit>, String> {
    let eol = line_ending(content);
    let (block, body_start) = split_frontmatter(content);
    let Some(inner) = block else {
        if content.lines().next().is_some_and(is_fence) {
            return Err(
                "the frontmatter block is never closed, or is larger than the 8 KB Glyph reads"
                    .to_string(),
            );
        }
        let Some(value) = value else {
            return Ok(None);
        };
        let entry = render(&key_text(key), value, "", None, None).join(eol);
        let edited = format!("---{eol}{entry}{eol}---{eol}{content}");
        return verified(edited, &[], key, Some(value), false).map(Some);
    };
    let entries = sited_entries(&inner).ok_or(
        "the frontmatter is not YAML Glyph reads: malformed, not a mapping, or a key appears twice",
    )?;
    if entries.windows(2).any(|pair| pair[0].line >= pair[1].line) {
        return Err("frontmatter written on one line as `{...}` cannot be edited".to_string());
    }

    // Line `n` of the block is line `n` of the note: the opening fence is 0.
    let starts: Vec<usize> = content
        .split_inclusive('\n')
        .scan(0, |at, line| {
            let start = *at;
            *at += line.len();
            Some(start)
        })
        .collect();
    let start_of = |line: usize| starts.get(line).copied().unwrap_or(content.len());
    let line_at =
        |line: usize| content[start_of(line)..start_of(line + 1)].trim_end_matches(['\r', '\n']);
    let closing_fence = body_start - 1;

    let found = entries.iter().position(|entry| entry.key == key);
    let (replaced, lines) = match (found, value) {
        (None, None) => return Ok(None),
        (None, Some(value)) => {
            let indent = entries
                .first()
                .map_or("", |first| indent_of(line_at(first.line)));
            let head = format!("{indent}{}", key_text(key));
            let lines = render(&head, value, "", None, None);
            (closing_fence..closing_fence, lines)
        }
        (Some(at), value) => {
            let entry = &entries[at];
            let next = entries.get(at + 1).map_or(closing_fence, |next| next.line);
            let last = last_line(entry, next, &line_at);
            let lines = match value {
                None => Vec::new(),
                Some(value) => rewritten(entry, value, &line_at)?,
            };
            (entry.line..last + 1, lines)
        }
    };

    let mut edited = String::with_capacity(content.len() + 64);
    edited.push_str(&content[..start_of(replaced.start)]);
    for line in &lines {
        edited.push_str(line);
        edited.push_str(eol);
    }
    edited.push_str(&content[start_of(replaced.end)..]);
    if edited == content {
        return Ok(None);
    }
    verified(edited, &entries, key, value, found.is_some()).map(Some)
}

/// `edited`, once parsing it again shows `key` holding `value` and every other
/// entry of `before` unchanged and in its place.
fn verified(
    edited: String,
    before: &[Entry],
    key: &str,
    value: Option<&NewValue>,
    existed: bool,
) -> Result<PropertyEdit, String> {
    let read_back = |scalar: &Scalar| Value::Scalar(scalar.text().to_string());
    let wanted = value.map(|value| match value {
        NewValue::Scalar(scalar) => read_back(scalar),
        NewValue::List(items) => Value::Sequence(items.iter().map(read_back).collect()),
    });
    let mut expected: Vec<(&str, Value)> = Vec::new();
    for entry in before {
        if entry.key != key {
            expected.push((&entry.key, entry.value.clone()));
        } else if let Some(wanted) = &wanted {
            expected.push((key, wanted.clone()));
        }
    }
    if !existed {
        expected.extend(wanted.map(|wanted| (key, wanted)));
    }

    let after = split_frontmatter(&edited).0.ok_or(
        "the frontmatter could not be read back once edited: it would grow past the 8 KB Glyph reads, or the note's line endings are not ones a block is split on",
    )?;
    let kept = sited_entries(&after).is_some_and(|after| {
        let same = |(entry, (key, value)): (&Entry, &(&str, Value))| {
            entry.key == *key && entry.value == *value
        };
        after.len() == expected.len() && after.iter().zip(&expected).all(same)
    });
    if !kept {
        return Err(format!(
            "{key} cannot be changed without disturbing the rest of the frontmatter"
        ));
    }
    Ok(PropertyEdit {
        content: edited,
        existed,
    })
}

fn indent_of(line: &str) -> &str {
    &line[..line.len() - line.trim_start_matches([' ', '\t']).len()]
}

/// Whether `entry` holds a quoted scalar that does not close on the line it
/// opens on, so the lines after it are still inside the quotes.
fn wraps_in_quotes<'a>(entry: &Entry, line_at: &impl Fn(usize) -> &'a str) -> bool {
    let quoted = matches!(
        entry.value_style,
        Some(TScalarStyle::SingleQuoted | TScalarStyle::DoubleQuoted)
    );
    if !quoted {
        return false;
    }
    let line = line_at(entry.value_line);
    let opens_at = match after_colon(line, entry.key_style) {
        Some(colon) if entry.value_line == entry.line => colon,
        _ => 0,
    };
    quoted_end(line[opens_at..].trim_start_matches([' ', '\t'])).is_none()
}

/// The last line of `entry`, which ends before line `next`: the comments and
/// blank lines after a value are not part of it.
fn last_line<'a>(entry: &Entry, next: usize, line_at: &impl Fn(usize) -> &'a str) -> usize {
    let block_scalar = matches!(
        entry.value_style,
        Some(TScalarStyle::Literal | TScalarStyle::Folded)
    );
    let depth = indent_of(line_at(entry.line)).len();
    let wraps = wraps_in_quotes(entry, line_at);
    let trails = |line: &str| {
        let text = line.trim_start_matches([' ', '\t']);
        if text.is_empty() {
            return true;
        }
        // Indented under a block scalar, or inside quotes still open, a `#`
        // line is the value's own text.
        let scalar_text = wraps || (block_scalar && indent_of(line).len() > depth);
        text.starts_with('#') && !scalar_text
    };
    let mut last = next - 1;
    while last > entry.line && trails(line_at(last)) {
        last -= 1;
    }
    last
}

/// The lines that replace `entry` when it takes `value`: the key as written,
/// the comment after it kept, and the value in the style the old one had.
fn rewritten<'a>(
    entry: &Entry,
    value: &NewValue,
    line_at: &impl Fn(usize) -> &'a str,
) -> Result<Vec<String>, String> {
    let line = line_at(entry.line);
    let colon = after_colon(line, entry.key_style)
        .ok_or_else(|| format!("{} is written in a way that cannot be edited", entry.key))?;
    let (head, rest) = line.split_at(colon);
    let comment = comment_at(rest).map_or("", |at| &rest[at..]);
    // A block sequence keeps its shape and its items' indent.
    let items_at = line_at(entry.value_line);
    let block_list = matches!(entry.value, Value::Sequence(_))
        && entry.value_line > entry.line
        && items_at.trim_start().starts_with('-');
    let item_indent = block_list.then(|| indent_of(items_at));
    Ok(render(head, value, comment, entry.value_style, item_indent))
}

/// An entry's lines: `head` is the key through its colon. A list is written
/// on one line unless `block_indent` says the one it replaces was a block.
fn render(
    head: &str,
    value: &NewValue,
    comment: &str,
    keep: Option<TScalarStyle>,
    block_indent: Option<&str>,
) -> Vec<String> {
    let items = match value {
        NewValue::Scalar(scalar) => {
            let scalar = scalar_text(scalar, keep, false);
            return vec![format!("{head} {scalar}{comment}")];
        }
        NewValue::List(items) => items,
    };
    match block_indent {
        Some(indent) if !items.is_empty() => {
            let mut lines = vec![format!("{head}{comment}")];
            for item in items {
                lines.push(format!("{indent}- {}", scalar_text(item, None, false)));
            }
            lines
        }
        _ => {
            let flow: Vec<String> = items
                .iter()
                .map(|item| scalar_text(item, None, true))
                .collect();
            vec![format!("{head} [{}]{comment}", flow.join(", "))]
        }
    }
}

fn key_text(key: &str) -> String {
    let key = Scalar::Text(key.to_string());
    format!("{}:", scalar_text(&key, None, false))
}

fn scalar_text(scalar: &Scalar, keep: Option<TScalarStyle>, flow: bool) -> String {
    let text = match scalar {
        Scalar::Bare(text) => return text.clone(),
        Scalar::Text(text) => text,
    };
    let one_line = !text.contains(|c: char| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'));
    match keep {
        Some(TScalarStyle::SingleQuoted) if one_line => format!("'{}'", text.replace('\'', "''")),
        Some(TScalarStyle::DoubleQuoted) => double_quoted(text),
        _ if one_line && plain_safe(text, flow) => text.clone(),
        _ => double_quoted(text),
    }
}

/// A JSON string is a YAML double-quoted scalar, escapes included.
fn double_quoted(text: &str) -> String {
    serde_json::Value::from(text).to_string()
}

/// Whether `text`, written bare, reads back as this same text.
fn plain_safe(text: &str, flow: bool) -> bool {
    let opens_something = |c: char| "-?:,[]{}#&*!|>'\"%@`".contains(c);
    !text.is_empty()
        && text.trim() == text
        && !text.starts_with(opens_something)
        && !text.ends_with(':')
        && !text.contains(": ")
        && !text.contains(" #")
        && !(flow && text.contains([',', '[', ']', '{', '}']))
        && !reads_as_another_type(text)
}

/// What another YAML reader would take for a null, a boolean or a number.
// ponytail: YAML 1.1 spellings such as `1_000` and `10:30` are written bare;
// quote on a digit-led pattern if a reader that old ever has to agree.
fn reads_as_another_type(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    const WORDS: [&str; 10] = [
        "null", "~", "true", "false", "yes", "no", "on", "off", ".inf", ".nan",
    ];
    WORDS.contains(&lower.as_str())
        || text.parse::<f64>().is_ok()
        || lower.starts_with("0x")
        || lower.starts_with("0o")
}

/// The byte after the colon that ends the key on its line.
fn after_colon(line: &str, key_style: TScalarStyle) -> Option<usize> {
    let indent = indent_of(line).len();
    let quoted = matches!(
        key_style,
        TScalarStyle::SingleQuoted | TScalarStyle::DoubleQuoted
    );
    let mut from = if quoted {
        indent + quoted_end(&line[indent..])?
    } else {
        indent
    };
    // A bare key may hold a colon; the one that ends it has a space or
    // nothing after it.
    loop {
        let colon = from + line[from..].find(':')?;
        let rest = &line[colon + 1..];
        if rest.is_empty() || rest.starts_with([' ', '\t']) {
            return Some(colon + 1);
        }
        from = colon + 1;
    }
}

/// The byte after the quote that closes the scalar `text` opens with.
fn quoted_end(text: &str) -> Option<usize> {
    let quote = text.chars().next()?;
    let mut chars = text.char_indices().skip(1).peekable();
    while let Some((at, c)) = chars.next() {
        if quote == '"' && c == '\\' {
            chars.next();
        } else if c == quote {
            // `''` inside single quotes is one quote, not the end.
            if quote == '\'' && chars.next_if(|(_, next)| *next == '\'').is_some() {
                continue;
            }
            return Some(at + 1);
        }
    }
    None
}

/// Where the comment starts in what follows a key's colon, with the space
/// before its `#`: a `#` after whitespace, outside any quoted scalar.
fn comment_at(rest: &str) -> Option<usize> {
    let mut at = 0;
    while let Some(c) = rest[at..].chars().next() {
        let before = rest[..at].trim_end_matches([' ', '\t']);
        let spaced = before.len() < at;
        // A quote opens a scalar only where one can start; inside bare text
        // it is just a character.
        let opens = before.is_empty() || before.ends_with(['[', ',', '{', ':']);
        if matches!(c, '"' | '\'') && opens {
            at += quoted_end(&rest[at..])?;
        } else if c == '#' && spaced {
            return Some(before.len());
        } else {
            at += c.len_utf8();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> NewValue {
        NewValue::Scalar(Scalar::Text(value.to_string()))
    }

    fn list(items: &[&str]) -> NewValue {
        NewValue::List(
            items
                .iter()
                .map(|item| Scalar::Text(item.to_string()))
                .collect(),
        )
    }

    fn set(content: &str, key: &str, value: &NewValue) -> String {
        set_property(content, key, Some(value))
            .unwrap()
            .expect("a change")
            .content
    }

    fn remove(content: &str, key: &str) -> String {
        set_property(content, key, None)
            .unwrap()
            .expect("a change")
            .content
    }

    /// Key order, a comment line, trailing comments, both quote styles, a
    /// block list and a nested mapping, then the body.
    const NOTE: &str = "---\n# Reviewed each quarter\ntitle: \"The Plan\"   # shown in the tab\nstatus: draft # not final\nauthor: 'Ada'\ntags:\n  - work   # main\n  - ideas\n\n# Dates below\ndue: 2026-10-15\nmeta:\n  owner: ops\n---\n\n# Body\n\nstatus: draft\n";

    #[test]
    fn setting_one_property_leaves_every_other_byte_as_it_was() {
        assert_eq!(
            set(NOTE, "status", &text("final")),
            NOTE.replacen("status: draft # not final", "status: final # not final", 1)
        );
        // A quoted value stays quoted the way it was.
        assert_eq!(
            set(NOTE, "title", &text("Plan B")),
            NOTE.replace("\"The Plan\"   # shown", "\"Plan B\"   # shown")
        );
        assert_eq!(
            set(NOTE, "author", &text("O'Neil")),
            NOTE.replace("'Ada'", "'O''Neil'")
        );
    }

    #[test]
    fn a_new_property_is_added_last_and_a_removed_one_takes_only_its_own_lines() {
        assert_eq!(
            set(NOTE, "reviewed", &text("2026-10-06")),
            NOTE.replace("  owner: ops\n", "  owner: ops\nreviewed: 2026-10-06\n")
        );
        assert_eq!(
            remove(NOTE, "status"),
            NOTE.replacen("status: draft # not final\n", "", 1)
        );
        // The blank line and the comment after the list belong to what follows.
        assert_eq!(
            remove(NOTE, "tags"),
            NOTE.replace("tags:\n  - work   # main\n  - ideas\n", "")
        );
        assert_eq!(
            remove(NOTE, "meta"),
            NOTE.replace("meta:\n  owner: ops\n", "")
        );
    }

    #[test]
    fn nothing_changes_when_there_is_nothing_to_change() {
        assert_eq!(set_property(NOTE, "missing", None), Ok(None));
        assert_eq!(set_property("# No block\n", "missing", None), Ok(None));
        assert_eq!(set_property(NOTE, "status", Some(&text("draft"))), Ok(None));
    }

    #[test]
    fn a_note_without_frontmatter_gets_a_block() {
        assert_eq!(
            set("# Title\r\nbody\r\n", "status", &text("draft")),
            "---\r\nstatus: draft\r\n---\r\n# Title\r\nbody\r\n"
        );
        assert_eq!(set("", "a", &text("b")), "---\na: b\n---\n");
        assert_eq!(
            set("---\n---\nbody\n", "a", &text("b")),
            "---\na: b\n---\nbody\n"
        );
    }

    fn block(inner: &str) -> String {
        format!("---\n{inner}---\nbody\n")
    }

    #[test]
    fn text_that_yaml_would_read_as_another_type_is_quoted() {
        let note = block("a: one\n");
        for (value, written) in [
            ("true", "\"true\""),
            ("No", "\"No\""),
            ("null", "\"null\""),
            ("~", "\"~\""),
            ("007", "\"007\""),
            ("1.5", "\"1.5\""),
            ("0x1F", "\"0x1F\""),
            ("", "\"\""),
            (" padded ", "\" padded \""),
            ("key: value", "\"key: value\""),
            ("tag #1", "\"tag #1\""),
            ("- item", "\"- item\""),
            ("[[Link]]", "\"[[Link]]\""),
            ("two\nlines", "\"two\\nlines\""),
            ("say \"hi\"", "say \"hi\""),
            ("2026-10-15", "2026-10-15"),
            ("C# notes, part 2", "C# notes, part 2"),
            ("میز کار", "میز کار"),
        ] {
            let edited = set(&note, "a", &text(value));
            assert_eq!(edited, block(&format!("a: {written}\n")), "{value:?}");
        }
        // A number or a boolean is written as one.
        for bare in ["3", "-1.5", "true"] {
            let value = NewValue::Scalar(Scalar::Bare(bare.to_string()));
            assert_eq!(set(&note, "a", &value), block(&format!("a: {bare}\n")));
        }
    }

    #[test]
    fn a_list_keeps_the_shape_it_had() {
        let listed = block("tags:\n    - a # first\n    - b\nnext: 1\n");
        assert_eq!(
            set(&listed, "tags", &list(&["x", "y, z", "true"])),
            block("tags:\n    - x\n    - y, z\n    - \"true\"\nnext: 1\n")
        );
        assert_eq!(
            set(&listed, "tags", &list(&[])),
            block("tags: []\nnext: 1\n")
        );
        assert_eq!(
            set(&listed, "tags", &text("one")),
            block("tags: one\nnext: 1\n")
        );

        // On one line it stays on one line, where a comma has to be quoted.
        let flow = block("tags: [a, b] # two\n");
        assert_eq!(
            set(&flow, "tags", &list(&["x", "y, z"])),
            block("tags: [x, \"y, z\"] # two\n")
        );
        // A list for a property that held one value, or none.
        assert_eq!(
            set(&block("a: one\n"), "a", &list(&["x"])),
            block("a: [x]\n")
        );
        assert_eq!(
            set(&block("a:\nb: 2\n"), "a", &list(&["x"])),
            block("a: [x]\nb: 2\n")
        );
    }

    #[test]
    fn comments_and_odd_keys_survive_the_entry_they_sit_on() {
        // A `#` inside quotes or glued to text is not a comment.
        let quoted = block("a: \"x # y\" # real\nb: c#d # real\nc: it's \"so # so\n");
        assert_eq!(
            set(&quoted, "a", &text("new")),
            quoted.replace("\"x # y\"", "\"new\"")
        );
        assert_eq!(
            set(&quoted, "b", &text("new")),
            quoted.replace("c#d", "new")
        );

        // Nor is one behind an escaped quote, or a doubled one.
        let escaped = block("a: \"x \\\" # y\" # real\nb: 'it''s # so' # real\n");
        assert_eq!(
            set(&escaped, "a", &text("new")),
            escaped.replace("\"x \\\" # y\"", "\"new\"")
        );
        assert_eq!(
            set(&escaped, "b", &text("new")),
            escaped.replace("'it''s # so'", "'new'")
        );
        // A quoted value running on to the next line is replaced whole.
        let wrapped = block("a: \"first\n  second\"\nb: 1\n");
        assert_eq!(
            set(&wrapped, "a", &text("new")),
            block("a: \"new\"\nb: 1\n")
        );
        // Even when its last line opens with a `#`, which is text in there.
        for inner in [
            "a: \"first\n  # second\"\nb: 1\n",
            "a:\n  'first\n  # second'\nb: 1\n",
        ] {
            assert_eq!(remove(&block(inner), "a"), block("b: 1\n"), "{inner:?}");
        }

        let keys = block("\"quoted: key\": 1\nurl:port: 2\n  # trailing\n");
        assert_eq!(
            set(&keys, "quoted: key", &text("x")),
            keys.replace(": 1", ": x")
        );
        assert_eq!(
            set(&keys, "url:port", &text("x")),
            keys.replace(": 2", ": x")
        );
        // A new key that YAML would misread is quoted, after the last comment.
        assert_eq!(
            set(&keys, "a: b", &text("x")),
            keys.replace("  # trailing\n", "  # trailing\n\"a: b\": x\n")
        );
    }

    #[test]
    fn a_block_scalar_is_replaced_whole_and_its_hash_lines_with_it() {
        let note = block("text: |\n  line\n  # not a comment\n\n# a comment\nnext: 1\n");
        assert_eq!(
            set(&note, "text", &text("short")),
            block("text: short\n\n# a comment\nnext: 1\n")
        );
        assert_eq!(remove(&note, "text"), block("\n# a comment\nnext: 1\n"));
    }

    #[test]
    fn the_last_property_can_go_and_an_empty_block_can_take_one() {
        assert_eq!(remove(&block("only: 1\n"), "only"), block(""));
        assert_eq!(
            set(&block("# note\n"), "a", &text("b")),
            block("# note\na: b\n")
        );
        // Indented entries take a new one at the same depth.
        assert_eq!(
            set(&block("  a: 1\n"), "b", &text("two")),
            block("  a: 1\n  b: two\n")
        );
    }

    #[test]
    fn a_block_that_cannot_be_edited_safely_is_refused_untouched() {
        let refused =
            |note: &str, key: &str| set_property(note, key, Some(&text("x"))).unwrap_err();
        // Malformed, a duplicate key, not a mapping.
        for inner in ["a: [unclosed\n", "a: 1\na: 2\n", "- one\n- two\n"] {
            assert!(refused(&block(inner), "a").contains("not YAML Glyph reads"));
        }
        assert!(refused("---\na: 1\n\nnever closed\n", "a").contains("never closed"));
        assert!(refused(&block("{a: 1, b: 2}\n"), "a").contains("one line"));
        assert!(refused(&block("{a: 1}\n"), "a").contains("disturbing"));
        // Another property reads this one's anchor, so it cannot change alone.
        assert!(refused(&block("a: &who Ada\nb: *who\n"), "a").contains("disturbing"));
        assert!(refused(&block("? a\n: 1\n"), "a").contains("cannot be edited"));

        let big = "x".repeat(8 * 1024);
        let grown = set_property(&block("a: 1\n"), "a", Some(&text(&big))).unwrap_err();
        assert!(grown.contains("8 KB"), "{grown}");
    }

    #[test]
    fn crlf_blocks_keep_their_line_endings() {
        let note = "---\r\ntitle: One\r\ntags: [a, b]\r\n---\r\nbody\r\n";
        assert_eq!(set(note, "title", &text("Two")), note.replace("One", "Two"));
        assert_eq!(
            set(note, "tags", &list(&["c"])),
            note.replace("[a, b]", "[c]")
        );
    }
}
