//! The per-note lookups the snapshot deliberately leaves out, so its payload
//! stays proportional to the file count rather than the link count.

use serde::{Deserialize, Serialize};

use super::canvas::Canvas;
use super::graph::Backlink;
use super::index::Vault;
use super::note::Note;
use super::query::{self, Filter};
use super::resolve::{compare_paths, MatchedBy, TieBreak};
use super::tags;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub filters: Vec<Filter>,
    /// The query minus its filters.
    pub text: String,
    /// Paths satisfying every filter. Empty when the query carried none: the
    /// caller has nothing to narrow by, and a workspace's whole path list is
    /// not worth sending on every keystroke.
    pub paths: Vec<String>,
}

/// Which links a walk through the graph follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Out,
    In,
    Both,
}

/// Where a target leads, and the other notes it names when it is ambiguous.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkResolution<'a> {
    pub path: &'a str,
    pub matched_by: MatchedBy,
    pub tie_break: Option<TieBreak>,
    /// The notes that lost, best first.
    pub candidates: Vec<&'a str>,
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

    /// Resolve one target as linked from `from`, with the reasoning.
    pub fn resolve_link(&self, target: &str, from: Option<&str>) -> Option<LinkResolution<'_>> {
        let found = self.resolver.resolve_detail(target, from)?;
        Some(LinkResolution {
            path: self.resolver.path(found.target),
            matched_by: found.matched_by,
            tie_break: found.tie_break,
            candidates: found
                .others
                .iter()
                .map(|&id| self.resolver.path(id))
                .collect(),
        })
    }

    /// Notes within `depth` link hops of `path`, nearest first, each with its
    /// hop count. Depth 1 in both directions is the graph view's neighbourhood.
    pub fn neighbors(&self, path: &str, depth: u32, direction: Direction) -> Vec<(&str, u32)> {
        let Some(start) = self.id_of(path) else {
            return Vec::new();
        };
        let mut seen = vec![false; self.notes.len()];
        seen[start] = true;
        let mut frontier = vec![start];
        let mut found = Vec::new();
        for hop in 1..=depth {
            let mut next = Vec::new();
            for id in frontier {
                for other in self.linked(id, direction) {
                    if !seen[other] {
                        seen[other] = true;
                        next.push(other);
                        found.push((self.notes[other].path.as_str(), hop));
                    }
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        found.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| compare_paths(a.0, b.0)));
        found
    }

    fn linked(&self, id: usize, direction: Direction) -> impl Iterator<Item = usize> + '_ {
        let follow_out = matches!(direction, Direction::Out | Direction::Both);
        let follow_in = matches!(direction, Direction::In | Direction::Both);
        let outgoing = follow_out.then(|| &self.graph.outgoing[id]);
        let incoming = follow_in.then(|| &self.graph.incoming[id]);
        outgoing.into_iter().chain(incoming).flatten().copied()
    }

    /// Parse a palette query and return the notes it selects.
    pub fn query(&self, raw: &str) -> QueryResult {
        let parsed = query::parse_query(raw, &self.field_names);
        let paths = if parsed.filters.is_empty() {
            Vec::new()
        } else {
            self.notes
                .iter()
                .filter(|note| query::matches_filters(note, &parsed.filters))
                .map(|note| note.path.clone())
                .collect()
        };
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

    /// What the index holds for the note at `path`.
    pub(crate) fn note(&self, path: &str) -> Option<&Note> {
        self.id_of(path).map(|id| &self.notes[id])
    }
}
