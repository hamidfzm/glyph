// Parse a `.canvas` JSON string into the normalized `CanvasData` model in
// `./types`. Tolerant by design: a node missing its required type-specific
// field (or any geometry) is dropped rather than throwing, so one malformed
// entry never blanks the whole board. Edges that reference a dropped/unknown
// node id are also discarded. The only hard failure is non-canvas JSON, which
// the viewer surfaces as an error state.

import {
  type BackgroundStyle,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  CanvasParseError,
  type EdgeEnd,
  type NodeSide,
} from "./types";

const SIDES: readonly NodeSide[] = ["top", "right", "bottom", "left"];
const ENDS: readonly EdgeEnd[] = ["none", "arrow"];
const BG_STYLES: readonly BackgroundStyle[] = ["cover", "ratio", "repeat"];

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function side(value: unknown): NodeSide | undefined {
  return SIDES.includes(value as NodeSide) ? (value as NodeSide) : undefined;
}

function end(value: unknown): EdgeEnd | undefined {
  return ENDS.includes(value as EdgeEnd) ? (value as EdgeEnd) : undefined;
}

/** Pull the shared geometry; returns null when any required field is missing. */
function parseBase(n: Record<string, unknown>) {
  const id = str(n.id);
  const x = num(n.x);
  const y = num(n.y);
  const width = num(n.width);
  const height = num(n.height);
  if (!id || x === null || y === null || width === null || height === null) return null;
  return { id, x, y, width, height, color: str(n.color) };
}

function parseNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const base = parseBase(n);
  if (!base) return null;
  switch (n.type) {
    case "text": {
      const text = str(n.text);
      return text === undefined ? null : { ...base, type: "text", text };
    }
    case "file": {
      const file = str(n.file);
      if (file === undefined) return null;
      const subpath = str(n.subpath);
      return { ...base, type: "file", file, ...(subpath ? { subpath } : {}) };
    }
    case "link": {
      const url = str(n.url);
      return url === undefined ? null : { ...base, type: "link", url };
    }
    case "group": {
      const label = str(n.label);
      const background = str(n.background);
      const bgStyle = n.backgroundStyle;
      return {
        ...base,
        type: "group",
        ...(label !== undefined ? { label } : {}),
        ...(background ? { background } : {}),
        ...(BG_STYLES.includes(bgStyle as BackgroundStyle)
          ? { backgroundStyle: bgStyle as BackgroundStyle }
          : {}),
      };
    }
    default:
      return null;
  }
}

function parseEdge(raw: unknown, nodeIds: Set<string>): CanvasEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = str(e.id);
  const fromNode = str(e.fromNode);
  const toNode = str(e.toNode);
  if (!id || !fromNode || !toNode) return null;
  // Dangling edges (endpoints that don't resolve) can't be drawn — drop them.
  if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) return null;
  return {
    id,
    fromNode,
    toNode,
    ...(side(e.fromSide) ? { fromSide: side(e.fromSide) } : {}),
    ...(side(e.toSide) ? { toSide: side(e.toSide) } : {}),
    ...(end(e.fromEnd) ? { fromEnd: end(e.fromEnd) } : {}),
    ...(end(e.toEnd) ? { toEnd: end(e.toEnd) } : {}),
    ...(str(e.color) ? { color: str(e.color) } : {}),
    ...(str(e.label) !== undefined ? { label: str(e.label) } : {}),
  };
}

/**
 * Parse `.canvas` JSON text into a `CanvasData`. Throws `CanvasParseError` when
 * the input isn't valid JSON or isn't a canvas object. An empty board (`{}`)
 * parses to `{ nodes: [], edges: [] }` — that's a valid blank canvas.
 */
export function parseCanvas(jsonText: string): CanvasData {
  const trimmed = jsonText.trim();
  // An empty file is a brand-new blank canvas, not an error.
  if (trimmed === "") return { nodes: [], edges: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new CanvasParseError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CanvasParseError("Canvas root is not an object");
  }
  // A `.canvas` file with `{}` is a valid empty Obsidian canvas. Missing
  // `nodes`/`edges` keys default to empty arrays rather than failing — the
  // dispatch only ever hands real `.canvas` files here, so there's no need to
  // reject an object that merely lacks those keys.
  const root = parsed as Record<string, unknown>;

  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const nodes = rawNodes.map(parseNode).filter((n): n is CanvasNode => n !== null);
  const nodeIds = new Set(nodes.map((n) => n.id));

  const rawEdges = Array.isArray(root.edges) ? root.edges : [];
  const edges = rawEdges
    .map((e) => parseEdge(e, nodeIds))
    .filter((e): e is CanvasEdge => e !== null);

  return { nodes, edges };
}
