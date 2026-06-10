// Pure geometry for laying out a canvas: where an edge attaches to a node, how
// to infer an attachment side when the file omits one, the bezier path between
// two endpoints, and the bounding box of a set of nodes. Kept free of React so
// it can be unit-tested in isolation and reused by both the renderer and the
// editor's hit-testing.

import type { BaseNode, CanvasNode, NodeSide } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Centre point of a node. */
export function nodeCenter(node: BaseNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** The point on a node's perimeter for the given side (midpoint of that edge). */
export function sideAnchor(node: BaseNode, side: NodeSide): Point {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/**
 * Choose the side of `from` that faces `to`, based on the dominant axis between
 * their centres. Used when an edge doesn't specify `fromSide`/`toSide`.
 */
export function inferSide(from: BaseNode, to: BaseNode): NodeSide {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Outward unit normal for a side, used to bow the bezier control points. */
export function sideNormal(side: NodeSide): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

/**
 * Build a cubic bezier `d` attribute connecting two anchor points, with control
 * points pushed out along each side's normal so the curve leaves and enters
 * perpendicular to the node edges (the Obsidian look). The control distance
 * scales with the gap between endpoints, clamped so short edges stay readable.
 */
export function bezierPath(
  start: Point,
  startSide: NodeSide,
  end: Point,
  endSide: NodeSide,
): string {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const ctrl = Math.max(30, Math.min(dist / 2, 150));
  const n1 = sideNormal(startSide);
  const n2 = sideNormal(endSide);
  const c1 = { x: start.x + n1.x * ctrl, y: start.y + n1.y * ctrl };
  const c2 = { x: end.x + n2.x * ctrl, y: end.y + n2.y * ctrl };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

/**
 * Build the three-point polygon for an arrowhead whose tip sits at `tip` on the
 * given side. The curve enters perpendicular to the side, so the arrow points
 * inward along `-sideNormal`. Returns an SVG `points` string.
 */
export function arrowheadPoints(tip: Point, side: NodeSide, size = 9): string {
  const n = sideNormal(side); // outward
  // Direction of travel into the node (the way the arrow points).
  const dir = { x: -n.x, y: -n.y };
  // Perpendicular to the travel direction, for the two base corners.
  const perp = { x: -dir.y, y: dir.x };
  const baseX = tip.x - dir.x * size;
  const baseY = tip.y - dir.y * size;
  const half = size * 0.6;
  const p1 = { x: baseX + perp.x * half, y: baseY + perp.y * half };
  const p2 = { x: baseX - perp.x * half, y: baseY - perp.y * half };
  return `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

/** True when a world point falls within a node's rectangle. */
export function nodeContainsPoint(node: BaseNode, p: Point): boolean {
  return (
    p.x >= node.x && p.x <= node.x + node.width && p.y >= node.y && p.y <= node.y + node.height
  );
}

/**
 * Topmost node (last in paint order) containing `p`, skipping ids in `exclude`
 * and group nodes (which are backdrops, not edge targets). Null when none hit.
 */
export function nodeAtPoint(
  nodes: readonly CanvasNode[],
  p: Point,
  exclude?: ReadonlySet<string>,
): CanvasNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === "group") continue;
    if (exclude?.has(n.id)) continue;
    if (nodeContainsPoint(n, p)) return n;
  }
  return null;
}

/**
 * Ids of the nodes a group contains: everything whose rectangle lies fully
 * inside the group's bounds (the group itself excluded). JSON Canvas has no
 * explicit membership — like Obsidian, containment is geometric, so dragging
 * a group carries these nodes along with it.
 */
export function nodeIdsInGroup(nodes: readonly CanvasNode[], group: BaseNode): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (n.id === group.id) continue;
    if (
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height
    ) {
      ids.add(n.id);
    }
  }
  return ids;
}

/** Axis-aligned bounding box covering every node; null for an empty canvas. */
export function nodesBoundingBox(nodes: readonly CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}
