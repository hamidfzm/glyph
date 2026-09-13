//! Tools that answer about the links around a note: what links to it, what
//! lies some hops away, and the cards of a board.

use serde::Deserialize;
use serde_json::{json, Value};

use super::refs::{
    capped, note_schema, read_vault, ref_property, resolve_note, vault_property, NoteArgs,
};
use super::registry::{arguments, Effect, Session, ToolDef};
use crate::vault::Direction;

pub(super) const BACKLINKS: ToolDef = ToolDef {
    name: "backlinks",
    title: "Backlinks",
    description: "Every note linking to this one, found by resolving every link in the vault the way Glyph does, so case, alias and heading variants count and prose mentions and fenced code do not. One row per linking line, with a snippet.",
    input_schema: note_schema,
    effect: Effect::ReadOnly,
    handler: backlinks,
};

fn backlinks(session: &Session, args: Value) -> Result<Value, String> {
    let args: NoteArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        Ok(json!({
            "path": found.path,
            "backlinks": capped(vault.backlinks(&found.path).iter()),
            "status": vault.status(),
        }))
    })
}

pub(super) const GRAPH_NEIGHBORS: ToolDef = ToolDef {
    name: "graph_neighbors",
    title: "Graph neighbours",
    description: "Notes within some number of link hops of a note, following resolved links outward, inward, or both, nearest first. Depth 1 in both directions is what Glyph's graph view highlights around a note.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "depth": { "type": "integer", "minimum": 1, "default": 1, "description": "How many hops to walk." },
                "direction": {
                    "type": "string",
                    "enum": ["out", "in", "both"],
                    "default": "both",
                    "description": "`out` follows the note's links, `in` the links to it."
                },
                "vault": vault_property()
            },
            "required": ["ref"],
            "additionalProperties": false
        })
    },
    effect: Effect::ReadOnly,
    handler: graph_neighbors,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NeighborsArgs {
    #[serde(rename = "ref")]
    note: String,
    depth: Option<u32>,
    direction: Option<Direction>,
    vault: Option<String>,
}

fn graph_neighbors(session: &Session, args: Value) -> Result<Value, String> {
    let args: NeighborsArgs = arguments(args)?;
    let depth = args.depth.unwrap_or(1);
    if depth == 0 {
        return Err("depth must be at least 1".to_string());
    }
    let direction = args.direction.unwrap_or(Direction::Both);
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        let around = vault.neighbors(&found.path, depth, direction);
        let neighbors = around
            .into_iter()
            .map(|(path, hops)| json!({ "path": path, "hops": hops }));
        Ok(json!({
            "path": found.path,
            "neighbors": capped(neighbors),
            "status": vault.status(),
        }))
    })
}

pub(super) const READ_CANVAS: ToolDef = ToolDef {
    name: "read_canvas",
    title: "Read a canvas",
    description: "A JSON Canvas board as nodes and edges: text, file, link and group cards with their geometry dropped, and only the edges whose ends exist.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The `.canvas` file, relative to the vault or absolute. A board's name works too."
                },
                "vault": vault_property()
            },
            "required": ["path"],
            "additionalProperties": false
        })
    },
    effect: Effect::ReadOnly,
    handler: read_canvas,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CanvasArgs {
    path: String,
    vault: Option<String>,
}

fn read_canvas(session: &Session, args: Value) -> Result<Value, String> {
    let args: CanvasArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.path)?;
        let canvas = vault
            .canvas(&found.path)
            .ok_or_else(|| format!("{} is not a canvas board", found.path))?;
        Ok(json!({
            "path": found.path,
            "nodes": capped(canvas.nodes.iter()),
            "edges": capped(canvas.edges.iter()),
            "status": vault.status(),
        }))
    })
}
