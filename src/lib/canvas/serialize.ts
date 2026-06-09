// Serialize a `CanvasData` model back to spec-valid `.canvas` JSON. Only
// defined fields are emitted, in the spec's documented key order, so files stay
// minimal and round-trip cleanly with Obsidian. Tab indentation matches
// Obsidian's own writer, keeping diffs small when the same file is edited in
// both apps.

import type { CanvasData, CanvasEdge, CanvasNode } from "./types";

/** Build an ordered plain object, skipping `undefined` values. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function nodeToJson(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
  switch (node.type) {
    case "text":
      return compact({ ...base, text: node.text, color: node.color });
    case "file":
      return compact({ ...base, file: node.file, subpath: node.subpath, color: node.color });
    case "link":
      return compact({ ...base, url: node.url, color: node.color });
    case "group":
      return compact({
        ...base,
        label: node.label,
        background: node.background,
        backgroundStyle: node.backgroundStyle,
        color: node.color,
      });
  }
}

function edgeToJson(edge: CanvasEdge): Record<string, unknown> {
  return compact({
    id: edge.id,
    fromNode: edge.fromNode,
    fromSide: edge.fromSide,
    fromEnd: edge.fromEnd,
    toNode: edge.toNode,
    toSide: edge.toSide,
    toEnd: edge.toEnd,
    color: edge.color,
    label: edge.label,
  });
}

/** Serialize a canvas to a tab-indented JSON string with a trailing newline. */
export function serializeCanvas(data: CanvasData): string {
  const out = {
    nodes: data.nodes.map(nodeToJson),
    edges: data.edges.map(edgeToJson),
  };
  return `${JSON.stringify(out, null, "\t")}\n`;
}
