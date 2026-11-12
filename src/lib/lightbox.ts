// Types and zoom math for the lightbox overlay (see Lightbox.tsx).

import type { ReactNode } from "react";

export interface LightboxImageItem {
  kind: "image";
  src: string;
  alt: string;
}

export interface LightboxTableItem {
  kind: "table";
  /** The document table's own children (head and body rows), rendered again. */
  content: ReactNode;
  /** The direction the table resolved to in the document (`ltr` or `rtl`). */
  dir: string;
}

export type LightboxItem = LightboxImageItem | LightboxTableItem;

export interface NaturalSize {
  w: number;
  h: number;
}

/** Multiplier applied per zoom-in / zoom-out step. */
export const ZOOM_STEP = 1.25;
export const MIN_SCALE = 0.1;
/** High ceiling on purpose: small diagrams must still fill 5K displays. */
export const MAX_SCALE = 50;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Scale that fits a natural-size image within the available box while
 * preserving aspect ratio (CSS `contain`). Returns 1 when any dimension is
 * unknown so the image renders at actual size until measured.
 */
export function fitScale(
  naturalWidth: number,
  naturalHeight: number,
  availWidth: number,
  availHeight: number,
): number {
  if (!naturalWidth || !naturalHeight || !availWidth || !availHeight) return 1;
  return clampScale(Math.min(availWidth / naturalWidth, availHeight / naturalHeight));
}

/**
 * Scale that fits a table to the available width, never above actual size: a
 * long table scrolls down rather than shrinking to fit the height.
 */
export function fitWidthScale(naturalWidth: number, availWidth: number): number {
  if (!naturalWidth || !availWidth) return 1;
  return clampScale(Math.min(1, availWidth / naturalWidth));
}
