// Pure pan/zoom transform math for the canvas stage. The world layer is
// rendered with `transform: translate(x, y) scale(zoom)`, so a world point
// `(wx, wy)` maps to screen `(x + wx*zoom, y + wy*zoom)`. These helpers convert
// between the two spaces and compute zoom-to-cursor and fit-to-content, kept
// free of React for unit testing.

import type { Point, Rect } from "./geometry";

export interface Viewport {
  /** Screen-space translation of the world origin, in pixels. */
  x: number;
  y: number;
  /** Scale factor; 1 = 100%. */
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/** Convert a screen-space point (relative to the stage) to world coordinates. */
export function screenToWorld(vp: Viewport, screen: Point): Point {
  return { x: (screen.x - vp.x) / vp.zoom, y: (screen.y - vp.y) / vp.zoom };
}

/** Convert a world-space point to screen coordinates (relative to the stage). */
export function worldToScreen(vp: Viewport, world: Point): Point {
  return { x: world.x * vp.zoom + vp.x, y: world.y * vp.zoom + vp.y };
}

/**
 * Multiply the zoom by `factor` while keeping the world point under `pivot`
 * (a screen-space point) visually fixed. Returns a new viewport.
 */
export function zoomAt(vp: Viewport, factor: number, pivot: Point): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  // World point currently under the pivot must stay under it after scaling.
  const world = screenToWorld(vp, pivot);
  return { zoom, x: pivot.x - world.x * zoom, y: pivot.y - world.y * zoom };
}

/** Translate the viewport by a screen-space delta. */
export function pan(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, x: vp.x + dx, y: vp.y + dy };
}

/**
 * Compute a viewport that centres `content` within a `width`×`height` stage,
 * leaving `padding` screen pixels around it. Zoom never exceeds 1 (we don't
 * blow small canvases up past natural size). Returns a neutral viewport when
 * the content rect is empty.
 */
export function fitToContent(
  content: Rect | null,
  width: number,
  height: number,
  padding = 40,
): Viewport {
  if (!content || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const contentW = Math.max(1, content.maxX - content.minX);
  const contentH = Math.max(1, content.maxY - content.minY);
  const zoom = clampZoom(
    Math.min(1, (width - padding * 2) / contentW, (height - padding * 2) / contentH),
  );
  const x = (width - contentW * zoom) / 2 - content.minX * zoom;
  const y = (height - contentH * zoom) / 2 - content.minY * zoom;
  return { x, y, zoom };
}
