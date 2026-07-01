// Convert an <svg> element into a pdfmake vector `svg` content node. Split out
// of htmlToPdf.ts (already past the size cap) so the walker stays focused on
// HTML structure.

import type { Content } from "pdfmake/interfaces";
import { ensureSvgXmlns } from "@/lib/svgDataUrl";

// Page content width for an A4 page with default pdfmake margins (~40pt each).
export const CONTENT_WIDTH = 515;

// Intrinsic width of an <svg>, from its width attribute (ignoring relative
// values like "100%", which Mermaid emits) or the viewBox. Null when neither
// yields a usable number.
function svgWidth(el: Element): number | null {
  const attr = el.getAttribute("width")?.trim();
  if (attr && !attr.endsWith("%")) {
    const w = Number.parseFloat(attr);
    if (Number.isFinite(w) && w > 0) return w;
  }
  const viewBox = el
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/);
  if (viewBox?.length === 4) {
    const w = Number.parseFloat(viewBox[2]);
    if (Number.isFinite(w) && w > 0) return w;
  }
  return null;
}

// Embed an <svg> element as a pdfmake vector node, scaled down to the page
// content width when wider. `ensureSvgXmlns` mirrors the data-URL path: the
// sanitizer strips the namespace from D2/Mermaid output.
export function svgNode(el: Element): Content {
  const width = Math.min(svgWidth(el) ?? CONTENT_WIDTH, CONTENT_WIDTH);
  return { svg: ensureSvgXmlns(el.outerHTML), width, margin: [0, 0, 0, 8] };
}
