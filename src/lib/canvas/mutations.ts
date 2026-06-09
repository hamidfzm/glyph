// Pure, immutable transforms on a `CanvasData`. Every function returns a new
// object (and new node/edge arrays where touched) without mutating its input,
// so they compose cleanly with React state and are trivial to unit-test. The
// editor calls these to produce the next board, then serializes and commits it.

import type { CanvasColor, CanvasData, CanvasEdge, CanvasNode } from "./types";

/** Move every node whose id is in `ids` by a screen-independent world delta. */
export function moveNodes(
  data: CanvasData,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): CanvasData {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return data;
  return {
    ...data,
    nodes: data.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
  };
}

/** Replace a node's geometry (used by resize handles). */
export function resizeNode(
  data: CanvasData,
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => (n.id === id ? { ...n, ...rect } : n)),
  };
}

/** Set (or clear, when `color` is undefined) the colour of the given nodes. */
export function setNodesColor(
  data: CanvasData,
  ids: ReadonlySet<string>,
  color: CanvasColor | undefined,
): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const { color: _drop, ...rest } = n;
      return color ? { ...rest, color } : (rest as CanvasNode);
    }),
  };
}

/** Replace the markdown body of a text node. */
export function updateTextNode(data: CanvasData, id: string, text: string): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => (n.id === id && n.type === "text" ? { ...n, text } : n)),
  };
}

/** Replace a group node's label. */
export function updateGroupLabel(data: CanvasData, id: string, label: string): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => (n.id === id && n.type === "group" ? { ...n, label } : n)),
  };
}

/** Append a node. */
export function addNode(data: CanvasData, node: CanvasNode): CanvasData {
  return { ...data, nodes: [...data.nodes, node] };
}

/** Remove nodes and any edge that touches one of them. */
export function removeNodes(data: CanvasData, ids: ReadonlySet<string>): CanvasData {
  if (ids.size === 0) return data;
  return {
    nodes: data.nodes.filter((n) => !ids.has(n.id)),
    edges: data.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode)),
  };
}

/** Append an edge (caller ensures both endpoints exist). */
export function addEdge(data: CanvasData, edge: CanvasEdge): CanvasData {
  return { ...data, edges: [...data.edges, edge] };
}

/** Remove a single edge by id. */
export function removeEdge(data: CanvasData, id: string): CanvasData {
  return { ...data, edges: data.edges.filter((e) => e.id !== id) };
}

/** Replace an edge's label (empty string clears it). */
export function updateEdgeLabel(data: CanvasData, id: string, label: string): CanvasData {
  return {
    ...data,
    edges: data.edges.map((e) => {
      if (e.id !== id) return e;
      const { label: _drop, ...rest } = e;
      return label ? { ...rest, label } : rest;
    }),
  };
}
