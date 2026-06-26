const SVG_NS = "http://www.w3.org/2000/svg";

// Turn SVG markup into a `data:` URL usable as an `<img src>`. We render SVGs
// this way (image viewer, diagram lightbox) instead of routing them through the
// asset protocol so they display reliably and need no extra request — the
// markup is already in hand. URL-encoding (not base64) keeps it readable and
// handles arbitrary unicode in the SVG.
//
// A standalone `<img>` parses the SVG as XML, so the root needs an `xmlns`
// declaration or it renders blank. Inline SVG (innerHTML) doesn't need it, and
// renderers/sanitizers routinely drop it — D2 and Mermaid diagrams come back
// without it — so add it back when absent.
export function svgToDataUrl(svg: string): string {
  const withNs = /<svg[^>]*\sxmlns\s*=/.test(svg)
    ? svg
    : svg.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`);
  return `data:image/svg+xml,${encodeURIComponent(withNs)}`;
}
