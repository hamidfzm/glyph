// Canvas rendering for the graph view: the theme pulled from the app's CSS
// custom properties, and the draw pass itself. The 2D context is only a sink
// for draw calls, so this stays unit-testable without a real canvas.

import { type Camera, nodeRadius, type Viewport } from "./graphCanvas";
import type { GraphLayout, LayoutNode } from "./graphSimulation";

const LABEL_MIN_SCALE = 0.7;
const ALPHA_DIMMED = 0.18;
const ALPHA_EDGE = 0.55;

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
