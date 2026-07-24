// Math for the temporary, per-tab zoom (note font scale, graph camera). The
// value is a multiplier: 1 means "the saved default", clamped to a sane range so
// content never zooms to an unusable size. Nothing here is persisted.

export const TAB_ZOOM_DEFAULT = 1;
export const TAB_ZOOM_MIN = 0.5;
export const TAB_ZOOM_MAX = 3;

// Multiplicative step per hotkey press.
const STEP = 1.1;
// Wheel/trackpad response: exponential in deltaY so a fast scroll zooms
// proportionally, matching the graph canvas feel.
const WHEEL_SPEED = 0.0015;

export function clampTabZoom(zoom: number): number {
  return Math.min(TAB_ZOOM_MAX, Math.max(TAB_ZOOM_MIN, zoom));
}

export function tabZoomIn(zoom: number): number {
  return clampTabZoom(zoom * STEP);
}

export function tabZoomOut(zoom: number): number {
  return clampTabZoom(zoom / STEP);
}

export function tabZoomByWheel(zoom: number, deltaY: number): number {
  return clampTabZoom(zoom * Math.exp(-deltaY * WHEEL_SPEED));
}
