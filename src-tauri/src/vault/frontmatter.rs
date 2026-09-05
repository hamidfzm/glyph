//! Frontmatter for the vault index, parsed with FAILSAFE semantics: every
//! scalar keeps its source text, so `2026-04-15`, `true` and `1.0` stay the
//! strings the document shows. Sequences and mappings still parse, which is
//! all `tags: [a, b]` needs.
//!
//! This tracks `src/lib/frontmatter.ts`, which parses the same block for the
//! renderer and the exporters. `fixtures/vault/` and `vault-frontmatter.json`
//! pin the fields, values and orderings both are expected to produce. Three
//! behaviours are known to differ and are deliberately not asserted there: an
//! explicit type tag such as `!!int` (which makes js-yaml's FAILSAFE schema
//! throw and this parser keep the scalar), the ordering of an integer-like
//! extra key (which `Object.entries` hoists on the JavaScript side), and an
//! anchor pointing at a sequence or mapping rather than a scalar.

use std::collections::HashMap;

use yaml_rust2::parser::{Event, EventReceiver, Parser};

/// The block is untrusted note content and every field reaches the frontend,
/// so it is bounded here rather than at the far end. A file whose frontmatter
/// exceeds the cap is indexed for its inline tags only.
const MAX_FRONTMATTER_BYTES: usize = 8 * 1024;
/// How deeply a block may nest. The parser recurses once per level and a
/// stack overflow aborts the process rather than unwinding, so this is checked
/// against the source text before the parser sees it. Frontmatter that nests
/// past this is pathological; real notes sit in single digits.
const MAX_NESTING_DEPTH: usize = 64;

#[derive(Debug, PartialEq)]
enum Value {
    Scalar(String),
    Sequence(Vec<Value>),
    Mapping(Vec<(String, Value)>),
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Frontmatter {
    pub title: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub tags: Vec<String>,
    /// `aliases:` in list or scalar form. Also present in `extra` as the
    /// joined string the renderer displays.
    pub aliases: Vec<String>,
    /// Every other key, in source order, with its original casing.
    pub extra: Vec<(String, String)>,
}

impl Frontmatter {
    fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.author.is_none()
            && self.date.is_none()
            && self.tags.is_empty()
            && self.extra.is_empty()
    }
}

/// The leading `---` fenced block's inner text plus the line index the body
/// starts at. `None` unless the file opens with the fence and closes it within
/// the byte cap.
pub(crate) fn split_frontmatter(content: &str) -> (Option<String>, usize) {
    // `lines` has already taken the `\r` of a CRLF ending, and the renderer's
    // pattern allows nothing else around the delimiter, so `---   ` opens no
    // block there and must open none here.
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return (None, 0);
    }
    let mut inner = String::new();
    for (idx, line) in lines.enumerate() {
        if line == "---" {
            return (Some(inner), idx + 2);
        }
        if inner.len() + line.len() > MAX_FRONTMATTER_BYTES {
            return (None, 0);
        }
        inner.push_str(line);
        inner.push('\n');
    }
    (None, 0)
}

/// Parse the inner text of a frontmatter block. `None` when the YAML is
/// malformed, is not a mapping, or carries nothing worth showing.
pub(crate) fn parse_frontmatter(inner: &str) -> Option<Frontmatter> {
    let entries = match parse_mapping(inner)? {
        Value::Mapping(entries) => entries,
        _ => return None,
    };

    let mut out = Frontmatter::default();
    for (key, value) in &entries {
        match key.as_str() {
            "title" => out.title = non_empty_scalar(value),
            "author" => out.author = non_empty_scalar(value),
            "date" => out.date = non_empty_scalar(value),
            "tags" => out.tags = string_list(value),
            _ => {
                if key == "aliases" {
                    out.aliases = string_list(value);
                }
                if let Some(text) = stringify(value) {
                    out.extra.push((key.clone(), text));
                }
            }
        }
    }

    if out.is_empty() {
        return None;
    }
    Some(out)
}

fn non_empty_scalar(value: &Value) -> Option<String> {
    match value {
        Value::Scalar(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// `tags: [a, b]`, `tags:\n  - a` and `tags: a` all reach the index as a list.
fn string_list(value: &Value) -> Vec<String> {
    match value {
        Value::Sequence(items) => items.iter().filter_map(non_empty_scalar).collect(),
        Value::Scalar(s) if !s.is_empty() => vec![s.clone()],
        _ => Vec::new(),
    }
}

/// How a field renders: a string as itself, a sequence joined, anything else
/// dropped.
fn stringify(value: &Value) -> Option<String> {
    match value {
        Value::Scalar(s) if !s.is_empty() => Some(s.clone()),
        Value::Sequence(items) => {
            let parts: Vec<String> = items
                .iter()
                .filter_map(|item| match item {
                    Value::Scalar(s) => Some(s.clone()),
                    _ => None,
                })
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(", "))
            }
        }
        _ => None,
    }
}

enum Frame {
    Sequence(Vec<Value>),
    Mapping {
        entries: Vec<(String, Value)>,
        key: Option<String>,
    },
}

#[derive(Default)]
struct Builder {
    stack: Vec<Frame>,
    root: Option<Value>,
    rejected: bool,
    /// Scalars carrying an `&anchor`, so a later `*alias` resolves to the same
    /// text the renderer's parser substitutes.
    anchors: HashMap<usize, String>,
}

impl Builder {
    fn push(&mut self, value: Value) {
        match self.stack.last_mut() {
            Some(Frame::Sequence(items)) => items.push(value),
            Some(Frame::Mapping { entries, key }) => match key.take() {
                Some(k) => entries.push((k, value)),
                // A non-scalar mapping key. The renderer's parser rejects the
                // document outright; matching that keeps the two in step.
                None => self.rejected = true,
            },
            None => {
                if self.root.is_some() {
                    self.rejected = true;
                } else {
                    self.root = Some(value);
                }
            }
        }
    }

    fn open(&mut self, frame: Frame) {
        self.stack.push(frame);
    }

    fn close(&mut self) {
        let value = match self.stack.pop() {
            Some(Frame::Sequence(items)) => Value::Sequence(items),
            Some(Frame::Mapping { entries, key }) => {
                if key.is_some() || has_duplicate_key(&entries) {
                    self.rejected = true;
                }
                Value::Mapping(entries)
            }
            None => {
                self.rejected = true;
                return;
            }
        };
        self.push(value);
    }
}

impl EventReceiver for Builder {
    fn on_event(&mut self, ev: Event) {
        match ev {
            Event::Scalar(text, _, anchor, _) => {
                if anchor > 0 {
                    self.anchors.insert(anchor, text.clone());
                }
                match self.stack.last_mut() {
                    Some(Frame::Mapping {
                        key: key @ None, ..
                    }) => *key = Some(text),
                    _ => self.push(Value::Scalar(text)),
                }
            }
            // An anchor on a sequence or mapping resolves to nothing, which is
            // what a field holding one already shows.
            Event::Alias(anchor) => {
                let text = self.anchors.get(&anchor).cloned().unwrap_or_default();
                self.push(Value::Scalar(text));
            }
            Event::SequenceStart(..) => self.open(Frame::Sequence(Vec::new())),
            Event::MappingStart(..) => self.open(Frame::Mapping {
                entries: Vec::new(),
                key: None,
            }),
            Event::SequenceEnd | Event::MappingEnd => self.close(),
            _ => {}
        }
    }
}

/// Whether `inner` nests past [`MAX_NESTING_DEPTH`] anywhere. Counted from the
/// source text because the parser recurses one frame per level as it reads,
/// so a block that is too deep has already overflowed the stack by the time
/// any event arrives. The three ways to open a level are an unclosed flow
/// bracket, a repeated `- ` on one line, and indentation.
fn too_deep(inner: &str) -> bool {
    let mut flow = 0usize;
    for line in inner.lines() {
        let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
        let dashes = line
            .trim_start_matches([' ', '\t'])
            .split("- ")
            .count()
            .saturating_sub(1);
        if indent > MAX_NESTING_DEPTH || dashes > MAX_NESTING_DEPTH {
            return true;
        }
        for c in line.chars() {
            match c {
                '[' | '{' => flow += 1,
                ']' | '}' => flow = flow.saturating_sub(1),
                _ => {}
            }
            if flow > MAX_NESTING_DEPTH {
                return true;
            }
        }
    }
    false
}

fn parse_mapping(inner: &str) -> Option<Value> {
    if too_deep(inner) {
        return None;
    }
    let mut builder = Builder::default();
    Parser::new_from_str(inner).load(&mut builder, false).ok()?;
    if builder.rejected || !builder.stack.is_empty() {
        return None;
    }
    let root = builder.root?;
    let Value::Mapping(entries) = &root else {
        return None;
    };
    if has_duplicate_key(entries) {
        return None;
    }
    Some(root)
}

/// js-yaml throws on a duplicate mapping key, so a block carrying one shows
/// nothing in the renderer and must index as nothing here too. Nested mappings
/// are checked as they close; this covers the root, which never does.
fn has_duplicate_key(entries: &[(String, Value)]) -> bool {
    let mut seen: Vec<&str> = Vec::with_capacity(entries.len());
    for (key, _) in entries {
        if seen.contains(&key.as_str()) {
            return true;
        }
        seen.push(key);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(block: &str) -> Option<Frontmatter> {
        let (inner, _) = split_frontmatter(block);
        parse_frontmatter(&inner?)
    }

    #[test]
    fn no_frontmatter_yields_nothing() {
        assert_eq!(parse("# Heading\n\nBody\n"), None);
        // The block must open the file, exactly as the renderer requires.
        assert_eq!(parse("intro\n---\ntitle: Note\n---\n"), None);
    }

    #[test]
    fn unterminated_block_yields_nothing() {
        assert_eq!(parse("---\ntitle: Note\n\nBody\n"), None);
    }

    #[test]
    fn known_fields_are_read() {
        let fm = parse("---\ntitle: Note\nauthor: Ada\ndate: 2026-04-15\n---\n").unwrap();
        assert_eq!(fm.title.as_deref(), Some("Note"));
        assert_eq!(fm.author.as_deref(), Some("Ada"));
        assert_eq!(fm.date.as_deref(), Some("2026-04-15"));
    }

    #[test]
    fn scalars_keep_their_source_text() {
        let fm =
            parse("---\ndate: 2026-04-15\ndraft: true\nversion: 1.0\ncount: 007\n---\n").unwrap();
        assert_eq!(fm.date.as_deref(), Some("2026-04-15"));
        assert_eq!(
            fm.extra,
            vec![
                ("draft".to_string(), "true".to_string()),
                ("version".to_string(), "1.0".to_string()),
                ("count".to_string(), "007".to_string()),
            ]
        );
    }

    #[test]
    fn quoted_scalars_lose_their_quotes() {
        let fm = parse("---\ntitle: \"Quoted\"\nnote: 'single'\n---\n").unwrap();
        assert_eq!(fm.title.as_deref(), Some("Quoted"));
        assert_eq!(fm.extra, vec![("note".to_string(), "single".to_string())]);
    }

    #[test]
    fn tags_parse_from_flow_and_block_sequences_and_a_scalar() {
        let flow = parse("---\ntags: [work, ideas]\n---\n").unwrap();
        assert_eq!(flow.tags, vec!["work", "ideas"]);

        let block = parse("---\ntags:\n  - work\n  - ideas\n---\n").unwrap();
        assert_eq!(block.tags, vec!["work", "ideas"]);

        let scalar = parse("---\ntags: work\n---\n").unwrap();
        assert_eq!(scalar.tags, vec!["work"]);
    }

    #[test]
    fn aliases_are_listed_and_still_shown_as_a_field() {
        let fm = parse("---\ntitle: Note\naliases: [Alt, Other]\n---\n").unwrap();
        assert_eq!(fm.aliases, vec!["Alt", "Other"]);
        assert_eq!(
            fm.extra,
            vec![("aliases".to_string(), "Alt, Other".to_string())]
        );
    }

    #[test]
    fn sequence_fields_join_with_commas_and_mappings_are_dropped() {
        let fm = parse("---\nlinks: [a, b]\nnested:\n  key: value\ntitle: Note\n---\n").unwrap();
        assert_eq!(fm.extra, vec![("links".to_string(), "a, b".to_string())]);
        assert_eq!(fm.title.as_deref(), Some("Note"));
    }

    #[test]
    fn empty_values_are_dropped() {
        assert_eq!(parse("---\ntitle:\nauthor:\n---\n"), None);
        let fm = parse("---\ntitle:\nkeep: yes\n---\n").unwrap();
        assert!(fm.title.is_none());
        assert_eq!(fm.extra, vec![("keep".to_string(), "yes".to_string())]);
    }

    #[test]
    fn malformed_yaml_yields_nothing() {
        assert_eq!(parse("---\n\tbad: [unclosed\n---\n"), None);
    }

    #[test]
    fn a_non_mapping_root_yields_nothing() {
        assert_eq!(parse("---\n- one\n- two\n---\n"), None);
        assert_eq!(parse("---\njust a string\n---\n"), None);
        assert_eq!(parse("---\n---\n"), None);
    }

    #[test]
    fn a_duplicate_key_yields_nothing() {
        assert_eq!(parse("---\ntitle: One\ntitle: Two\n---\n"), None);
    }

    #[test]
    fn crlf_blocks_parse() {
        let fm = parse("---\r\ntitle: Note\r\ntags: [a]\r\n---\r\n").unwrap();
        assert_eq!(fm.title.as_deref(), Some("Note"));
        assert_eq!(fm.tags, vec!["a"]);
    }

    #[test]
    fn an_oversized_block_is_skipped_entirely() {
        let block = format!(
            "---\nbig: {}\n---\nbody\n",
            "x".repeat(MAX_FRONTMATTER_BYTES)
        );
        assert_eq!(split_frontmatter(&block), (None, 0));
    }

    #[test]
    fn deeply_nested_values_are_refused_before_the_parser_recurses() {
        // Each of these opens one parser frame per level, and the parser
        // recurses as it reads: reaching it at all overflows the stack, which
        // aborts the process rather than unwinding. The block cap allows
        // thousands of levels, so the depth check has to come first.
        let depth = MAX_NESTING_DEPTH + 5;
        let flow = format!("key: {}{}", "[".repeat(depth), "]".repeat(depth));
        assert_eq!(parse_frontmatter(&flow), None);

        let block_sequence = format!("{}x\n", "- ".repeat(1_000));
        assert_eq!(parse_frontmatter(&block_sequence), None);

        let indented = format!("{}deep: value\n", " ".repeat(depth + 1));
        assert_eq!(parse_frontmatter(&indented), None);

        // A block that nests normally still parses.
        let shallow = "outer:\n  middle:\n    inner: value\ntitle: Note\n";
        assert!(parse_frontmatter(shallow).is_some());
    }

    #[test]
    fn an_alias_resolves_to_its_anchor() {
        let fm = parse("---\nauthor: &who Ada\ncredit: *who\n---\n").unwrap();
        assert_eq!(fm.author.as_deref(), Some("Ada"));
        assert_eq!(fm.extra, vec![("credit".to_string(), "Ada".to_string())]);
    }

    #[test]
    fn a_duplicate_key_nested_in_a_mapping_yields_nothing() {
        assert_eq!(
            parse("---\ntitle: Note\nnested:\n  a: 1\n  a: 2\n---\n"),
            None
        );
    }

    #[test]
    fn a_delimiter_with_trailing_space_is_not_a_fence() {
        // The renderer's pattern does not accept it, so neither does the index.
        assert_eq!(parse("---   \ntitle: Note\n---\n"), None);
        assert_eq!(parse("---\ntitle: Note\n---   \n"), None);
    }

    #[test]
    fn body_starts_after_the_closing_fence() {
        let (inner, body_start) = split_frontmatter("---\ntitle: Note\n---\n\n#tag body\n");
        assert_eq!(inner.as_deref(), Some("title: Note\n"));
        // Lines 0 to 2 are the block itself, so the body opens at line 3.
        assert_eq!(body_start, 3);
    }
}
