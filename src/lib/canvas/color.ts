// Maps a JSON Canvas colour to a CSS colour value. The spec allows two forms:
// a raw hex string (`#FF0000`) used verbatim, or a preset index `"1"`–`"6"`.
//
// Presets resolve to a themeable CSS custom property with the Obsidian default
// as the fallback, so a theme can override `--glyph-canvas-color-1` etc. while
// untouched themes still get the familiar palette. Per the frontend rule, we
// route through custom properties rather than hard-coding colours in JSX.

import type { CanvasColor } from "./types";

/** Obsidian's default preset palette, indexed by the spec's `"1"`–`"6"`. */
const PRESET_FALLBACKS: Record<string, string> = {
  "1": "#fb464c", // red
  "2": "#e9973f", // orange
  "3": "#e0de71", // yellow
  "4": "#44cf6e", // green
  "5": "#53dfdd", // cyan
  "6": "#a882ff", // purple
};

/**
 * Resolve a canvas colour to a CSS colour string, or `undefined` when no colour
 * is set (callers fall back to the default node border/background).
 */
export function canvasColorToCss(color: CanvasColor | undefined): string | undefined {
  if (!color) return undefined;
  const fallback = PRESET_FALLBACKS[color];
  if (fallback) return `var(--glyph-canvas-color-${color}, ${fallback})`;
  return color; // hex (or any CSS-valid colour) passes through unchanged
}

/** True when the colour is one of the named presets rather than a hex value. */
export function isPresetColor(color: CanvasColor | undefined): boolean {
  return color != null && color in PRESET_FALLBACKS;
}

/** The ordered preset keys, for building a colour-picker UI. */
export const PRESET_COLORS: readonly string[] = Object.keys(PRESET_FALLBACKS);
