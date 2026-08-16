// Serialize SVG markup as well-formed XML. Every consumer here parses it
// strictly (an `<img>` data URL, a blob-URL image, pdfmake's SVG renderer), so
// markup the HTML parser tolerates and XML rejects makes the whole image fail,
// not just the offending node. Mermaid flowcharts are the case that bites: they
// render labels as HTML inside `<foreignObject>`, and a `<br/>` in the source
// comes out as a bare `<br>`, so the image renders blank. Parsing as HTML and
// reserializing as XML closes those tags, and the serializer writes the `xmlns`
// the root needs (renderers and sanitizers routinely drop it).
export function toXmlSvg(svg: string): string {
  const root = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
  return root ? new XMLSerializer().serializeToString(root) : svg;
}

// Turn SVG markup into a `data:` URL usable as an `<img src>`. We render SVGs
// this way (image viewer, diagram lightbox) instead of routing them through the
// asset protocol so they display reliably and need no extra request — the
// markup is already in hand. URL-encoding (not base64) keeps it readable and
// handles arbitrary unicode in the SVG.
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(toXmlSvg(svg))}`;
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
