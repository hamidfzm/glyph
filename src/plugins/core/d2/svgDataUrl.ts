/**
 * A `data:` URL for the lightbox's `<img>`. An image parses SVG as strict XML,
 * and DOMPurify's output can lack the root `xmlns`, so reserialize as XML
 * (which writes it) before encoding.
 */
export function svgToDataUrl(svg: string): string {
  const root = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
  const xml = root ? new XMLSerializer().serializeToString(root) : svg;
  return `data:image/svg+xml,${encodeURIComponent(xml)}`;
}
