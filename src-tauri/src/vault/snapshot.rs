//! What the UI reads on workspace open and after a watcher refresh.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::graph::{GraphEdge, GraphNode, UnresolvedLink};
use super::index::Vault;
use super::tags;
use crate::commands::walk::ScanStatus;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub path: String,
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphView<'a> {
    pub nodes: &'a [GraphNode],
    pub edges: &'a [GraphEdge],
}

/// What the UI reads on workspace open and after a watcher refresh. Snippets
/// are not in here: they arrive per note through [`Vault::backlinks`], which
/// keeps this payload proportional to the file count rather than the link
/// count.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot<'a> {
    pub files: Vec<&'a str>,
    /// Notes carrying at least one tag or frontmatter field.
    pub notes: Vec<NoteSummary>,
    pub graph: GraphView<'a>,
    pub tag_counts: Vec<TagCount>,
    /// Every frontmatter field name used anywhere in the workspace.
    pub field_names: Vec<&'a str>,
    pub unresolved: &'a [UnresolvedLink],
    pub dead_ends: &'a [String],
    pub status: &'a ScanStatus,
}

impl Vault {
    pub fn snapshot(&self) -> VaultSnapshot<'_> {
        VaultSnapshot {
            files: self.notes.iter().map(|note| note.path.as_str()).collect(),
            notes: self
                .notes
                .iter()
                .filter(|note| !note.tags.is_empty() || !note.fields.is_empty())
                .map(|note| NoteSummary {
                    path: note.path.clone(),
                    title: note.title.clone(),
                    tags: note.tags.clone(),
                    fields: note.fields.clone(),
                })
                .collect(),
            graph: GraphView {
                nodes: &self.graph.nodes,
                edges: &self.graph.edges,
            },
            tag_counts: self.tag_counts(),
            field_names: self.field_names.iter().map(String::as_str).collect(),
            unresolved: &self.graph.unresolved,
            dead_ends: &self.graph.dead_ends,
            status: &self.status,
        }
    }

    /// Every tag in the workspace, most frequent first, ties broken by name. A
    /// nested tag counts toward each of its ancestors once per file, so a
    /// parent's count matches the list [`Vault::paths_with_tag`] returns.
    fn tag_counts(&self) -> Vec<TagCount> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for note in &self.notes {
            let mut in_file: BTreeSet<String> = BTreeSet::new();
            for tag in &note.tags {
                in_file.extend(tags::with_ancestors(tag));
            }
            for tag in in_file {
                *counts.entry(tag).or_insert(0) += 1;
            }
        }
        let mut out: Vec<TagCount> = counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
        out
    }
}
