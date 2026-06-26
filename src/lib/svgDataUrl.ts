// Turn SVG markup into a `data:` URL usable as an `<img src>`. We render SVGs
// this way (image viewer, diagram lightbox) instead of routing them through the
// asset protocol so they display reliably and need no extra request — the
// markup is already in hand. URL-encoding (not base64) keeps it readable and
// handles arbitrary unicode in the SVG.
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
