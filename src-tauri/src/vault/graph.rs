//! The views derived from resolved links: the workspace graph, backlinks per
//! note, and the links that go nowhere.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::note::Note;
use super::resolve::{compare_paths, dir_of, stem_of, Resolver};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Absolute file path, the unique node id.
    pub id: String,
    /// File name without its extension.
    pub label: String,
    /// Number of distinct neighbours, in either direction.
    pub degree: usize,
    /// True when no resolved link points into or out of this file.
    pub orphan: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source: String,
    pub line: u32,
    pub snippet: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedLink {
    pub source: String,
    /// Target as written, with `|alias` and `#heading` already removed.
    pub target: String,
    pub line: u32,
}

#[derive(Debug, Default)]
pub(crate) struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Undirected adjacency, indexed by note id.
    pub neighbors: Vec<BTreeSet<usize>>,
    /// Inbound links, indexed by note id.
    pub backlinks: Vec<Vec<Backlink>>,
    pub unresolved: Vec<UnresolvedLink>,
    /// Notes with no outgoing resolved link.
    pub dead_ends: Vec<String>,
}

pub(crate) fn build(notes: &[Note], resolver: &Resolver) -> Graph {
    let mut neighbors: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); notes.len()];
    let mut backlinks: Vec<Vec<Backlink>> = (0..notes.len()).map(|_| Vec::new()).collect();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut unresolved: Vec<UnresolvedLink> = Vec::new();
    let mut has_outgoing = vec![false; notes.len()];
    let mut seen_edges: BTreeSet<(usize, usize)> = BTreeSet::new();
    // Resolution depends only on the target and the linking file's directory,
    // and a target naming a path is matched by scanning every indexed path, so
    // hub-heavy vaults stay linear in unique targets rather than links times
    // files.
    let mut resolved: HashMap<(&str, &str), Option<usize>> = HashMap::new();

    for (source, note) in notes.iter().enumerate() {
        for link in &note.links {
            let key = (link.target.as_str(), dir_of(&note.path));
            let hit = *resolved
                .entry(key)
                .or_insert_with(|| resolver.resolve(&link.target, Some(&note.path)));
            let Some(target) = hit else {
                unresolved.push(UnresolvedLink {
                    source: note.path.clone(),
                    target: link.target.clone(),
                    line: link.line,
                });
                continue;
            };
            if target == source {
                continue;
            }
            has_outgoing[source] = true;

            // A line can hold several links to the same note, which would
            // otherwise surface as duplicate backlink rows sharing a snippet.
            let already = backlinks[target]
                .iter()
                .any(|back| back.source == note.path && back.line == link.line);
            if !already {
                backlinks[target].push(Backlink {
                    source: note.path.clone(),
                    line: link.line,
                    snippet: link.snippet.clone(),
                });
            }

            neighbors[source].insert(target);
            neighbors[target].insert(source);
            if seen_edges.insert((source, target)) {
                edges.push(GraphEdge {
                    source: note.path.clone(),
                    target: notes[target].path.clone(),
                });
            }
        }
    }

    for rows in &mut backlinks {
        rows.sort_by(|a, b| compare_paths(&a.source, &b.source).then_with(|| a.line.cmp(&b.line)));
    }

    let nodes = notes
        .iter()
        .enumerate()
        .map(|(id, note)| {
            let degree = neighbors[id].len();
            GraphNode {
                id: note.path.clone(),
                label: stem_of(&note.path).to_string(),
                degree,
                orphan: degree == 0,
            }
        })
        .collect();

    let dead_ends = notes
        .iter()
        .enumerate()
        .filter(|(id, _)| !has_outgoing[*id])
        .map(|(_, note)| note.path.clone())
        .collect();

    Graph {
        nodes,
        edges,
        neighbors,
        backlinks,
        unresolved,
        dead_ends,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::note::extract_note;

    fn graph_of(files: &[(&str, &str)]) -> (Vec<Note>, Graph) {
        let notes: Vec<Note> = files
            .iter()
            .map(|(path, body)| extract_note(path, body))
            .collect();
        let paths: Vec<String> = notes.iter().map(|note| note.path.clone()).collect();
        let aliases: Vec<Vec<String>> = notes.iter().map(|note| note.aliases.clone()).collect();
        let resolver = Resolver::build(&paths, &aliases);
        let graph = build(&notes, &resolver);
        (notes, graph)
    }

    fn edge_pairs(graph: &Graph) -> Vec<(String, String)> {
        graph
            .edges
            .iter()
            .map(|e| (e.source.clone(), e.target.clone()))
            .collect()
    }

    #[test]
    fn one_node_per_file_labelled_by_stem() {
        let (_, graph) = graph_of(&[("/w/A.md", ""), ("/w/sub/B.md", "")]);
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.nodes[0].label, "A");
        assert_eq!(graph.nodes[1].label, "B");
    }

    #[test]
    fn a_resolved_link_becomes_one_directed_edge() {
        let (_, graph) = graph_of(&[("/w/A.md", "see [[B]]\n"), ("/w/B.md", "")]);
        assert_eq!(
            edge_pairs(&graph),
            vec![("/w/A.md".to_string(), "/w/B.md".to_string())]
        );
    }

    #[test]
    fn aliases_and_headings_do_not_change_the_edge() {
        let (_, graph) = graph_of(&[("/w/A.md", "see [[B#Top|the other]]\n"), ("/w/B.md", "")]);
        assert_eq!(edge_pairs(&graph).len(), 1);
    }

    #[test]
    fn broken_and_self_links_are_dropped() {
        let (_, graph) = graph_of(&[("/w/A.md", "[[Missing]] and [[A]]\n")]);
        assert!(graph.edges.is_empty());
        assert_eq!(graph.unresolved.len(), 1);
        assert_eq!(graph.unresolved[0].target, "Missing");
        assert_eq!(graph.unresolved[0].line, 1);
    }

    #[test]
    fn parallel_links_collapse_but_the_reverse_edge_survives() {
        let (_, graph) = graph_of(&[
            ("/w/A.md", "[[B]] and again [[B]]\n"),
            ("/w/B.md", "back to [[A]]\n"),
        ]);
        assert_eq!(
            edge_pairs(&graph),
            vec![
                ("/w/A.md".to_string(), "/w/B.md".to_string()),
                ("/w/B.md".to_string(), "/w/A.md".to_string()),
            ]
        );
    }

    #[test]
    fn degree_counts_distinct_neighbours_in_either_direction() {
        let (_, graph) = graph_of(&[
            ("/w/A.md", "[[B]] [[C]]\n"),
            ("/w/B.md", "[[A]]\n"),
            ("/w/C.md", ""),
            ("/w/D.md", ""),
        ]);
        assert_eq!(graph.nodes[0].degree, 2);
        assert_eq!(graph.nodes[1].degree, 1);
        assert_eq!(graph.nodes[2].degree, 1);
        assert_eq!(graph.nodes[3].degree, 0);
        assert!(graph.nodes[3].orphan);
        assert!(!graph.nodes[2].orphan);
    }

    #[test]
    fn backlinks_list_inbound_links_once_per_source_line() {
        let (_, graph) = graph_of(&[
            (
                "/w/A.md",
                "[[Target]] twice [[Target]]\nand again [[Target]]\n",
            ),
            ("/w/Target.md", "self [[Target]]\n"),
        ]);
        let rows = &graph.backlinks[1];
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].source, "/w/A.md");
        assert_eq!(rows[0].line, 1);
        assert_eq!(rows[1].line, 2);
        assert!(rows[0].snippet.contains("[[Target]]"));
        // The self-link contributes nothing.
        assert!(graph.backlinks[1]
            .iter()
            .all(|r| r.source != "/w/Target.md"));
    }

    #[test]
    fn backlinks_are_ordered_by_source_then_line() {
        let (_, graph) = graph_of(&[
            ("/w/b.md", "[[T]]\n"),
            ("/w/A.md", "\n[[T]]\n"),
            ("/w/T.md", ""),
        ]);
        let rows = &graph.backlinks[2];
        assert_eq!(
            rows.iter().map(|r| r.source.as_str()).collect::<Vec<_>>(),
            vec!["/w/A.md", "/w/b.md"]
        );
    }

    #[test]
    fn the_resolution_memo_keeps_per_directory_answers_apart() {
        // Both notes write the same target; each must reach its own neighbour.
        let (_, graph) = graph_of(&[
            ("/w/a/Note.md", "[[Shared]]\n"),
            ("/w/a/Shared.md", ""),
            ("/w/b/Note.md", "[[Shared]]\n"),
            ("/w/b/Shared.md", ""),
        ]);
        assert_eq!(
            edge_pairs(&graph),
            vec![
                ("/w/a/Note.md".to_string(), "/w/a/Shared.md".to_string()),
                ("/w/b/Note.md".to_string(), "/w/b/Shared.md".to_string()),
            ]
        );
    }

    #[test]
    fn dead_ends_are_notes_with_no_outgoing_resolved_link() {
        let (_, graph) = graph_of(&[
            ("/w/A.md", "[[B]]\n"),
            ("/w/B.md", "[[Missing]]\n"),
            ("/w/C.md", ""),
        ]);
        assert_eq!(graph.dead_ends, vec!["/w/B.md", "/w/C.md"]);
    }
}
