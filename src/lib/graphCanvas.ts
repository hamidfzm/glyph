// Camera math, hit-testing, and canvas drawing for the graph view. All pure
// functions of their inputs (the 2D context is just a sink for draw calls),
// so the whole rendering pipeline is unit-testable without a real canvas.

import type { GraphLayout, LayoutNode } from "./graphSimulation";

/** Pan offset (screen px, relative to the viewport center) plus zoom scale.
 *  screen = world * scale + viewport_center + (dx, dy). Keeping the offset
 *  relative to the center means a window resize re-centers for free. */
export interface Camera {
  dx: number;
  dy: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const DEFAULT_CAMERA: Camera = { dx: 0, dy: 0, scale: 1 };
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
// Auto-fit never zooms in past this, so a tiny graph fills the viewport
// comfortably instead of blowing a couple of nodes up to fill the screen.
const FIT_MAX_SCALE = 1.6;
// Breathing room (screen px) left around the graph when fitting.
const FIT_PADDING = 48;

/** Labels are unreadable clutter when zoomed far out; hide them below this. */
const LABEL_MIN_SCALE = 0.7;
const ALPHA_DIMMED = 0.18;
const ALPHA_EDGE = 0.55;

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, dx: camera.dx + dx, dy: camera.dy + dy };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
export function zoomCameraAt(
  camera: Camera,
  sx: number,
  sy: number,
  factor: number,
  viewport: Viewport,
): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  if (scale === camera.scale) return camera;
  const k = scale / camera.scale;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return {
    scale,
    dx: sx - cx - (sx - cx - camera.dx) * k,
    dy: sy - cy - (sy - cy - camera.dy) * k,
  };
}

export function worldToScreen(
  camera: Camera,
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: x * camera.scale + viewport.width / 2 + camera.dx,
    y: y * camera.scale + viewport.height / 2 + camera.dy,
  };
}

export function screenToWorld(
  camera: Camera,
  viewport: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: (sx - viewport.width / 2 - camera.dx) / camera.scale,
    y: (sy - viewport.height / 2 - camera.dy) / camera.scale,
  };
}

/** Node radius in world units, growing gently with connectivity. */
export function nodeRadius(degree: number): number {
  return Math.min(14, 4 + Math.sqrt(degree) * 1.8);
}

/**
 * Camera that frames every node within the viewport (with padding), centred.
 * Used to auto-fit the graph on open and to re-frame it on "Reset view", so
 * the user never has to hunt for an off-screen or clumped layout. Returns the
 * default camera for an empty graph.
 */
export function fitCameraToNodes(
  nodes: readonly LayoutNode[],
  viewport: Viewport,
  padding = FIT_PADDING,
): Camera {
  if (nodes.length === 0 || viewport.width === 0 || viewport.height === 0) {
    return DEFAULT_CAMERA;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = nodeRadius(node.degree);
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
  }
  // Guard against a zero-size span (single node, or all stacked) so the scale
  // stays finite.
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const usableW = Math.max(viewport.width - padding * 2, 1);
  const usableH = Math.max(viewport.height - padding * 2, 1);
  const rawScale = Math.min(usableW / spanX, usableH / spanY);
  const scale = Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, rawScale));
  // Map the graph's world centre onto the viewport centre: with
  // screen = world * scale + viewport/2 + d, centring needs d = -centre * scale.
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  return { scale, dx: -centreX * scale, dy: -centreY * scale };
}

/**
 * Topmost node under the screen point (nodes drawn later win), or null.
 * `slop` widens the target in screen px so small nodes stay clickable when
 * zoomed out.
 */
export function hitTestNode(
  nodes: readonly LayoutNode[],
  camera: Camera,
  viewport: Viewport,
  sx: number,
  sy: number,
  slop = 3,
): LayoutNode | null {
  const world = screenToWorld(camera, viewport, sx, sy);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const r = nodeRadius(node.degree) + slop / camera.scale;
    const dx = (node.x ?? 0) - world.x;
    const dy = (node.y ?? 0) - world.y;
    if (dx * dx + dy * dy <= r * r) return node;
  }
  return null;
}

export interface GraphTheme {
  node: string;
  nodeOrphan: string;
  nodeActive: string;
  edge: string;
  edgeActive: string;
  label: string;
}

/** Pull the graph palette out of the app's CSS custom properties so the view
 *  follows the platform theme. Falls back to readable neutrals when a
 *  variable is missing (e.g. in tests). */
export function readGraphTheme(element: Element): GraphTheme {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    node: read("--color-text-secondary", "#888888"),
    nodeOrphan: read("--color-text-tertiary", "#666666"),
    nodeActive: read("--color-accent", "#4a9eff"),
    edge: read("--color-border", "#44444466"),
    edgeActive: read("--color-accent", "#4a9eff"),
    label: read("--color-text-primary", "#cccccc"),
  };
}

export interface DrawGraphOptions {
  viewport: Viewport;
  /** Device pixel ratio; the canvas backing store is viewport * dpr. */
  dpr: number;
  camera: Camera;
  theme: GraphTheme;
  /** Hovered node id; when set, its neighborhood is highlighted, rest dimmed. */
  hoveredId: string | null;
  neighbors: ReadonlyMap<string, ReadonlySet<string>>;
}

/** True when this node is part of the highlighted neighborhood. */
function isActive(id: string, options: DrawGraphOptions): boolean {
  const { hoveredId, neighbors } = options;
  if (hoveredId === null) return false;
  return id === hoveredId || (neighbors.get(hoveredId)?.has(id) ?? false);
}

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  layout: GraphLayout,
  options: DrawGraphOptions,
): void {
  const { viewport, dpr, camera, theme, hoveredId } = options;
  const hovering = hoveredId !== null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  // World transform: scale + center + pan. Everything below draws in world
  // units; stroke widths and fonts divide by scale to stay constant on screen.
  ctx.setTransform(
    dpr * camera.scale,
    0,
    0,
    dpr * camera.scale,
    dpr * (viewport.width / 2 + camera.dx),
    dpr * (viewport.height / 2 + camera.dy),
  );

  // Edges first, under the nodes.
  ctx.lineWidth = 1 / camera.scale;
  for (const link of layout.links) {
    const active = hovering && (link.source.id === hoveredId || link.target.id === hoveredId);
    ctx.strokeStyle = active ? theme.edgeActive : theme.edge;
    ctx.globalAlpha = active ? 0.9 : hovering ? ALPHA_DIMMED : ALPHA_EDGE;
    ctx.beginPath();
    ctx.moveTo(link.source.x ?? 0, link.source.y ?? 0);
    ctx.lineTo(link.target.x ?? 0, link.target.y ?? 0);
    ctx.stroke();
    // Subtle direction cue, drawn only for the hovered neighborhood where it
    // is readable (and cheap).
    if (active) drawArrowTip(ctx, link.source, link.target, camera.scale, theme.edgeActive);
  }

  for (const node of layout.nodes) {
    const active = isActive(node.id, options);
    ctx.globalAlpha = hovering && !active ? ALPHA_DIMMED : 1;
    ctx.fillStyle = active ? theme.nodeActive : node.orphan ? theme.nodeOrphan : theme.node;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.degree), 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels: skip when zoomed far out, except for the hovered neighborhood.
  const showAllLabels = camera.scale >= LABEL_MIN_SCALE;
  ctx.font = `${11 / camera.scale}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.label;
  for (const node of layout.nodes) {
    const active = isActive(node.id, options);
    if (!showAllLabels && !active) continue;
    ctx.globalAlpha = hovering && !active ? ALPHA_DIMMED : 0.85;
    ctx.fillText(
      node.label,
      node.x ?? 0,
      (node.y ?? 0) + nodeRadius(node.degree) + 3 / camera.scale,
    );
  }
  ctx.globalAlpha = 1;
}

function drawArrowTip(
  ctx: CanvasRenderingContext2D,
  source: LayoutNode,
  target: LayoutNode,
  scale: number,
  color: string,
): void {
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  const angle = Math.atan2(ty - (source.y ?? 0), tx - (source.x ?? 0));
  // Sit the tip on the target's rim, not its center.
  const tipX = tx - Math.cos(angle) * nodeRadius(target.degree);
  const tipY = ty - Math.sin(angle) * nodeRadius(target.degree);
  const size = 5 / scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle - Math.PI / 6),
    tipY - size * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    tipX - size * Math.cos(angle + Math.PI / 6),
    tipY - size * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}
