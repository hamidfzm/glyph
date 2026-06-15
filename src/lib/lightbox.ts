// Types and zoom math for the image lightbox overlay (see Lightbox.tsx).

export interface LightboxImage {
  src: string;
  alt: string;
}

/** Multiplier applied per zoom-in / zoom-out step. */
export const ZOOM_STEP = 1.25;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

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
