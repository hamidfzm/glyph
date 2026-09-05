//! JSON Canvas (https://jsoncanvas.org) for the vault index: which cards a
//! board holds and how they connect. Geometry is rendering data and stays with
//! the editor's own model; the validation that decides whether a node exists
//! at all is kept, so both sides see the same set of cards.

use serde::Serialize;
use serde_json::Value;

use super::note::{Link, Note};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    /// `text`, `file`, `link` or `group`.
    pub kind: String,
    pub text: Option<String>,
    /// Linked path of a file card, relative to the workspace.
    pub file: Option<String>,
    /// In-file anchor of a file card, always beginning with `#`.
    pub subpath: Option<String>,
    pub url: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub label: Option<String>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub nodes: Vec<CanvasNode>,
    pub edges: Vec<CanvasEdge>,
}

/// Parse a `.canvas` file. A blank file is an empty board rather than an
/// error; malformed JSON, or a root that is not an object, indexes as nothing.
pub(crate) fn parse_canvas(json: &str) -> Option<Canvas> {
    if json.trim().is_empty() {
        return Some(Canvas::default());
    }
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(json) else {
        return None;
    };

    let nodes: Vec<CanvasNode> = array(root.get("nodes"))
        .iter()
        .filter_map(parse_node)
        .collect();
    let edges = array(root.get("edges"))
        .iter()
        .filter_map(|raw| parse_edge(raw, &nodes))
        .collect();

    Some(Canvas { nodes, edges })
}

fn array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn text(raw: &Value, key: &str) -> Option<String> {
    raw.get(key).and_then(Value::as_str).map(str::to_string)
}

/// A non-empty string field, for the ones a card cannot exist without.
fn required(raw: &Value, key: &str) -> Option<String> {
    text(raw, key).filter(|value| !value.is_empty())
}

fn parse_node(raw: &Value) -> Option<CanvasNode> {
    let id = required(raw, "id")?;
    // Geometry is not indexed, but a card missing it is not a card.
    for key in ["x", "y", "width", "height"] {
        raw.get(key)
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())?;
    }

    let kind = text(raw, "type")?;
    let mut node = CanvasNode {
        id,
        kind: kind.clone(),
        text: None,
        file: None,
        subpath: None,
        url: None,
        label: None,
    };
    match kind.as_str() {
        // An empty text card is still a card; only a missing field drops it.
        "text" => node.text = Some(text(raw, "text")?),
        "file" => {
            node.file = required(raw, "file");
            node.file.as_ref()?;
            node.subpath = required(raw, "subpath");
        }
        "link" => {
            node.url = required(raw, "url");
            node.url.as_ref()?;
        }
        "group" => node.label = text(raw, "label"),
        _ => return None,
    }
    Some(node)
}

fn parse_edge(raw: &Value, nodes: &[CanvasNode]) -> Option<CanvasEdge> {
    let id = required(raw, "id")?;
    let from_node = required(raw, "fromNode")?;
    let to_node = required(raw, "toNode")?;
    // An edge to a card that did not survive parsing is not an edge.
    let known = |id: &str| nodes.iter().any(|node| node.id == id);
    if !known(&from_node) || !known(&to_node) {
        return None;
    }
    Some(CanvasEdge {
        id,
        from_node,
        to_node,
        label: text(raw, "label"),
    })
}

/// Index one `.canvas` file: the board itself, plus the note entry that puts
/// its file cards into the workspace graph as outgoing links.
pub(crate) fn extract_canvas(path: &str, content: &str) -> (Note, Canvas) {
    let canvas = parse_canvas(content).unwrap_or_default();
    let links = canvas
        .nodes
        .iter()
        .filter_map(|node| {
            let target = node.file.clone()?;
            Some(Link {
                snippet: target.clone(),
                target,
                line: 0,
            })
        })
        .collect();

    let note = Note {
        path: path.to_string(),
        links,
        ..Note::default()
    };
    (note, canvas)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(json: &str) -> Option<CanvasNode> {
        parse_canvas(&format!("{{\"nodes\":[{json}]}}"))?
            .nodes
            .into_iter()
            .next()
    }

    #[test]
    fn a_blank_file_is_an_empty_board() {
        assert_eq!(parse_canvas("   "), Some(Canvas::default()));
        assert_eq!(parse_canvas("{}"), Some(Canvas::default()));
    }

    #[test]
    fn malformed_input_indexes_as_nothing() {
        assert_eq!(parse_canvas("{not json"), None);
        assert_eq!(parse_canvas("[1, 2]"), None);
        assert_eq!(parse_canvas("null"), None);
    }

    #[test]
    fn every_card_kind_parses() {
        let text =
            node(r##"{"id":"a","type":"text","text":"# Hi","x":0,"y":0,"width":1,"height":1}"##)
                .unwrap();
        assert_eq!(text.kind, "text");
        assert_eq!(text.text.as_deref(), Some("# Hi"));

        let file = node(
            r##"{"id":"b","type":"file","file":"Notes/A.md","subpath":"#Top","x":0,"y":0,"width":1,"height":1}"##,
        )
        .unwrap();
        assert_eq!(file.file.as_deref(), Some("Notes/A.md"));
        assert_eq!(file.subpath.as_deref(), Some("#Top"));

        let link = node(
            r##"{"id":"c","type":"link","url":"https://x.test","x":0,"y":0,"width":1,"height":1}"##,
        )
        .unwrap();
        assert_eq!(link.url.as_deref(), Some("https://x.test"));

        let group =
            node(r##"{"id":"d","type":"group","label":"Area","x":0,"y":0,"width":1,"height":1}"##)
                .unwrap();
        assert_eq!(group.label.as_deref(), Some("Area"));
    }

    #[test]
    fn an_empty_text_card_survives_but_a_missing_field_does_not() {
        assert!(
            node(r##"{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1}"##)
                .is_some()
        );
        assert!(node(r##"{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1}"##).is_none());
        assert!(node(r##"{"id":"b","type":"file","x":0,"y":0,"width":1,"height":1}"##).is_none());
        assert!(node(r##"{"id":"c","type":"link","x":0,"y":0,"width":1,"height":1}"##).is_none());
    }

    #[test]
    fn cards_without_an_id_geometry_or_known_kind_are_dropped() {
        assert!(node(r##"{"type":"text","text":"x","x":0,"y":0,"width":1,"height":1}"##).is_none());
        assert!(
            node(r##"{"id":"a","type":"text","text":"x","y":0,"width":1,"height":1}"##).is_none()
        );
        assert!(node(
            r##"{"id":"a","type":"text","text":"x","x":null,"y":0,"width":1,"height":1}"##
        )
        .is_none());
        assert!(node(r##"{"id":"a","type":"other","x":0,"y":0,"width":1,"height":1}"##).is_none());
        assert!(node("42").is_none());
    }

    #[test]
    fn edges_need_both_endpoints_to_exist() {
        let canvas = parse_canvas(
            r##"{"nodes":[
                {"id":"a","type":"text","text":"a","x":0,"y":0,"width":1,"height":1},
                {"id":"b","type":"text","text":"b","x":0,"y":0,"width":1,"height":1}
            ],"edges":[
                {"id":"e1","fromNode":"a","toNode":"b","label":"via"},
                {"id":"e2","fromNode":"a","toNode":"ghost"},
                {"id":"e3","fromNode":"a"}
            ]}"##,
        )
        .unwrap();
        assert_eq!(
            canvas.edges,
            vec![CanvasEdge {
                id: "e1".into(),
                from_node: "a".into(),
                to_node: "b".into(),
                label: Some("via".into()),
            }]
        );
    }

    #[test]
    fn non_array_node_and_edge_fields_are_treated_as_empty() {
        let canvas = parse_canvas(r##"{"nodes":"nope","edges":7}"##).unwrap();
        assert_eq!(canvas, Canvas::default());
    }

    #[test]
    fn file_cards_become_outgoing_links() {
        let (note, canvas) = extract_canvas(
            "/w/board.canvas",
            r##"{"nodes":[
                {"id":"a","type":"file","file":"Notes/A.md","subpath":"#Top","x":0,"y":0,"width":1,"height":1},
                {"id":"b","type":"text","text":"card","x":0,"y":0,"width":1,"height":1}
            ]}"##,
        );
        assert_eq!(canvas.nodes.len(), 2);
        assert_eq!(note.path, "/w/board.canvas");
        assert_eq!(note.links.len(), 1);
        assert_eq!(note.links[0].target, "Notes/A.md");
    }

    #[test]
    fn an_unreadable_board_indexes_as_an_empty_one() {
        let (note, canvas) = extract_canvas("/w/board.canvas", "{not json");
        assert_eq!(canvas, Canvas::default());
        assert!(note.links.is_empty());
    }

    #[test]
    fn serialized_keys_are_camel_case() {
        let json = serde_json::to_string(&CanvasEdge {
            id: "e".into(),
            from_node: "a".into(),
            to_node: "b".into(),
            label: None,
        })
        .unwrap();
        assert!(json.contains("\"fromNode\":\"a\""));
        assert!(!json.contains("from_node"));
    }
}
