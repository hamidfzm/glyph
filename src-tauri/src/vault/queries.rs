//! The per-note lookups the snapshot deliberately leaves out, so its payload
//! stays proportional to the file count rather than the link count.

use serde::Serialize;

use super::canvas::Canvas;
use super::graph::Backlink;
use super::index::Vault;
use super::query::{self, Filter};
use super::tags;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub filters: Vec<Filter>,
    /// The query minus its filters.
    pub text: String,
    /// Paths satisfying every filter, or every indexed path when there are none.
    pub paths: Vec<String>,
}

impl Vault {
    /// Inbound links to `path`, with the snippet of the line each came from.
    pub fn backlinks(&self, path: &str) -> &[Backlink] {
        match self.id_of(path) {
            Some(id) => &self.graph.backlinks[id],
            None => &[],
        }
    }

    /// Resolve several targets at once, as linked from `from`. One call per
    /// rendered document rather than one per link.
    pub fn resolve_many(&self, from: Option<&str>, targets: &[String]) -> Vec<Option<&str>> {
        targets
            .iter()
            .map(|target| {
                self.resolver
                    .resolve(target, from)
                    .map(|id| self.resolver.path(id))
            })
            .collect()
    }

    /// Directly connected notes, in either direction.
    pub fn neighbors(&self, path: &str) -> Vec<&str> {
        let Some(id) = self.id_of(path) else {
            return Vec::new();
        };
        self.graph.neighbors[id]
            .iter()
            .map(|&other| self.notes[other].path.as_str())
            .collect()
    }

    /// Parse a palette query and return the notes it selects.
    pub fn query(&self, raw: &str) -> QueryResult {
        let parsed = query::parse_query(raw, &self.field_names);
        let paths = self
            .notes
            .iter()
            .filter(|note| query::matches_filters(note, &parsed.filters))
            .map(|note| note.path.clone())
            .collect();
        QueryResult {
            filters: parsed.filters,
            text: parsed.text,
            paths,
        }
    }

    /// Files carrying `tag` or one of its nested children (`work/urgent`).
    pub fn paths_with_tag(&self, tag: &str) -> Vec<&str> {
        let wanted = tags::normalize_tag(tag);
        if wanted.is_empty() {
            return Vec::new();
        }
        let nested = format!("{wanted}/");
        self.notes
            .iter()
            .filter(|note| {
                note.tags
                    .iter()
                    .any(|t| t == &wanted || t.starts_with(&nested))
            })
            .map(|note| note.path.as_str())
            .collect()
    }

    /// The parsed board of an indexed `.canvas` file.
    pub fn canvas(&self, path: &str) -> Option<&Canvas> {
        let id = self.id_of(path)?;
        self.canvases.get(&self.notes[id].path)
    }
}
