const SVG_NS = "http://www.w3.org/2000/svg";

// A standalone `<img>` parses SVG as XML, so the root needs an `xmlns`
// declaration or it renders blank. Inline SVG (innerHTML) doesn't need it, and
// renderers/sanitizers routinely drop it — D2 and Mermaid diagrams come back
// without it — so add it back when absent.
export function ensureSvgXmlns(svg: string): string {
  return /<svg[^>]*\sxmlns\s*=/.test(svg) ? svg : svg.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`);
}

// Turn SVG markup into a `data:` URL usable as an `<img src>`. We render SVGs
// this way (image viewer, diagram lightbox) instead of routing them through the
// asset protocol so they display reliably and need no extra request — the
// markup is already in hand. URL-encoding (not base64) keeps it readable and
// handles arbitrary unicode in the SVG.
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(ensureSvgXmlns(svg))}`;
}

// Decode a `data:image/svg+xml` URL (base64 or URI-encoded) back to its SVG
// markup. Returns null for non-SVG data URLs or an undecodable payload.
export function decodeSvgDataUrl(src: string): string | null {
  const comma = src.indexOf(",");
  if (!/^data:image\/svg\+xml/i.test(src) || comma < 0) return null;
  const payload = src.slice(comma + 1);
  try {
    return /;base64/i.test(src.slice(0, comma)) ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}
