//! Metadata filters in a palette query: `tag:foo`, `status:draft`,
//! `project:"side quest"`. Field syntax follows Obsidian's so notes migrating
//! from it keep working. Whatever is left after the filters is plain search
//! text and still goes through the caller's fuzzy matcher.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use super::note::Note;
use super::tags::normalize_tag;

const TAG_FIELDS: [&str; 2] = ["tag", "tags"];

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    /// Lowercased field name; `tag` and `tags` match the tag set.
    pub field: String,
    /// Lowercased value, unquoted.
    pub value: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParsedQuery {
    pub filters: Vec<Filter>,
    /// The query minus its filters, trimmed.
    pub text: String,
}

/// ASCII `\w` on purpose: the renderer's pattern is JavaScript's, where `\w`
/// does not include letters outside ASCII.
fn filter_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r#"([A-Za-z][0-9A-Za-z_-]*):("[^"]*"|\S+)"#).unwrap())
}

/// Split `query` into metadata filters and leftover search text. `fields` is
/// the set of frontmatter field names the workspace actually uses: a
/// `word:value` term naming anything else (a pasted `C:\notes\x`, a
/// `Section:Overview` heading) stays plain text instead of filtering the
/// results down to nothing.
pub(crate) fn parse_query(query: &str, fields: &BTreeSet<String>) -> ParsedQuery {
    let mut filters = Vec::new();
    let mut rest = String::with_capacity(query.len());
    let mut cursor = 0;

    for caps in filter_pattern().captures_iter(query) {
        let whole = caps.get(0).expect("group 0 always matches");
        let field = caps[1].to_lowercase();
        let raw_value = &caps[2];
        // A value with only an opening quote keeps its text; the renderer
        // drops its last character instead, which is no use mid-typing.
        let value = raw_value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(raw_value)
            .trim();

        let usable =
            !value.is_empty() && (TAG_FIELDS.contains(&field.as_str()) || fields.contains(&field));
        if !usable {
            continue;
        }

        rest.push_str(&query[cursor..whole.start()]);
        // Removing a filter from the middle would otherwise join the words on
        // either side of it into one.
        rest.push(' ');
        cursor = whole.end();
        filters.push(Filter {
            field,
            value: value.to_lowercase(),
        });
    }
    rest.push_str(&query[cursor..]);

    ParsedQuery {
        filters,
        text: rest.split_whitespace().collect::<Vec<_>>().join(" "),
    }
}

fn matches_filter(note: &Note, filter: &Filter) -> bool {
    if TAG_FIELDS.contains(&filter.field.as_str()) {
        let wanted = normalize_tag(&filter.value);
        let nested = format!("{wanted}/");
        return note
            .tags
            .iter()
            .any(|tag| tag == &wanted || tag.starts_with(&nested));
    }
    // Substring, so `project:glyph` still finds "Glyph Docs".
    note.fields
        .get(&filter.field)
        .is_some_and(|value| value.to_lowercase().contains(&filter.value))
}

/// Whether `note` satisfies every filter (AND, like Obsidian).
pub(crate) fn matches_filters(note: &Note, filters: &[Filter]) -> bool {
    filters.iter().all(|filter| matches_filter(note, filter))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::note::extract_note;

    fn fields(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    fn filter(field: &str, value: &str) -> Filter {
        Filter {
            field: field.to_string(),
            value: value.to_string(),
        }
    }

    #[test]
    fn a_filter_is_lifted_out_of_the_search_text() {
        let parsed = parse_query("tag:work notes", &fields(&[]));
        assert_eq!(parsed.filters, vec![filter("tag", "work")]);
        assert_eq!(parsed.text, "notes");
    }

    #[test]
    fn a_filter_removed_from_the_middle_leaves_one_space() {
        let parsed = parse_query("weekly tag:work notes", &fields(&[]));
        assert_eq!(parsed.text, "weekly notes");
    }

    #[test]
    fn only_fields_the_workspace_uses_become_filters() {
        let known = parse_query("status:draft", &fields(&["status"]));
        assert_eq!(known.filters, vec![filter("status", "draft")]);
        assert_eq!(known.text, "");

        let unknown = parse_query("Section:Overview", &fields(&["status"]));
        assert!(unknown.filters.is_empty());
        assert_eq!(unknown.text, "Section:Overview");
    }

    #[test]
    fn a_pasted_windows_path_stays_plain_text() {
        let parsed = parse_query(r"C:\notes\x", &fields(&["status"]));
        assert!(parsed.filters.is_empty());
        assert_eq!(parsed.text, r"C:\notes\x");
    }

    #[test]
    fn quoted_values_may_hold_spaces() {
        let parsed = parse_query("project:\"side quest\" left", &fields(&["project"]));
        assert_eq!(parsed.filters, vec![filter("project", "side quest")]);
        assert_eq!(parsed.text, "left");
    }

    #[test]
    fn fields_and_values_are_lowercased() {
        let parsed = parse_query("Status:Draft", &fields(&["status"]));
        assert_eq!(parsed.filters, vec![filter("status", "draft")]);
    }

    #[test]
    fn a_bare_colon_and_an_empty_quoted_value_stay_plain_text() {
        for query in ["just: text", "project:\"\" left"] {
            let parsed = parse_query(query, &fields(&["project"]));
            assert!(parsed.filters.is_empty(), "{query}");
        }
    }

    #[test]
    fn a_query_without_filters_is_untouched() {
        let parsed = parse_query("weekly review", &fields(&["status"]));
        assert!(parsed.filters.is_empty());
        assert_eq!(parsed.text, "weekly review");
    }

    #[test]
    fn several_filters_are_all_lifted() {
        let parsed = parse_query("tag:work status:draft rest", &fields(&["status"]));
        assert_eq!(
            parsed.filters,
            vec![filter("tag", "work"), filter("status", "draft")]
        );
        assert_eq!(parsed.text, "rest");
    }

    #[test]
    fn no_filters_matches_everything() {
        let note = extract_note("/w/a.md", "plain body\n");
        assert!(matches_filters(&note, &[]));
    }

    #[test]
    fn tag_filters_match_nested_children() {
        let note = extract_note("/w/a.md", "body #work/urgent\n");
        assert!(matches_filters(&note, &[filter("tag", "work")]));
        assert!(matches_filters(&note, &[filter("tags", "work/urgent")]));
        assert!(!matches_filters(&note, &[filter("tag", "wor")]));
        assert!(!matches_filters(&note, &[filter("tag", "home")]));
    }

    #[test]
    fn field_filters_match_case_insensitive_substrings() {
        let note = extract_note("/w/a.md", "---\nproject: Glyph Docs\n---\n");
        assert!(matches_filters(&note, &[filter("project", "glyph")]));
        assert!(!matches_filters(&note, &[filter("project", "other")]));
        assert!(!matches_filters(&note, &[filter("status", "draft")]));
    }

    #[test]
    fn every_filter_must_match() {
        let note = extract_note("/w/a.md", "---\nstatus: draft\n---\n\nbody #work\n");
        assert!(matches_filters(
            &note,
            &[filter("tag", "work"), filter("status", "draft")]
        ));
        assert!(!matches_filters(
            &note,
            &[filter("tag", "home"), filter("status", "draft")]
        ));
    }
}
