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
// content width when wider.
//
// An element mounted in the live document is passed through as-is:
// pdfmake then renders it with `useCSS`, so the browser resolves the diagram's
// own <style> block. Passing markup instead leaves the styling to
// svg-to-pdfkit's selector parser, which only matches a single compound
// selector and silently drops every descendant rule Mermaid and D2 emit
// (`.node rect`, `.edgePath .path`), painting the shapes with default fills.
// An element parsed into a standalone document (an SVG image decoded from a
// data: URL) is never laid out, so it has no computed style to read and goes
// as markup; `ensureSvgXmlns` restores the namespace the sanitizer strips.
export function svgNode(el: Element): Content {
  const width = Math.min(svgWidth(el) ?? CONTENT_WIDTH, CONTENT_WIDTH);
  const svg = document.contains(el) ? (el as SVGElement) : ensureSvgXmlns(el.outerHTML);
  return { svg, width, margin: [0, 0, 0, 8] };
}
