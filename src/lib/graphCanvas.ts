// Camera math and hit-testing for the graph view. All pure functions of their
// inputs, so the pipeline is unit-testable without a real canvas. The draw pass
// lives in graphDraw.ts.

import type { LayoutNode } from "./graphSimulation";

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
