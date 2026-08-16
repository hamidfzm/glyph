// Convert an <svg> element into a pdfmake vector `svg` content node. Split out
// of htmlToPdf.ts (already past the size cap) so the walker stays focused on
// HTML structure.

import type { Content } from "pdfmake/interfaces";
import { toXmlSvg } from "@/lib/svgDataUrl";

// Page content box for an A4 page with default pdfmake margins (~40pt each).
export const CONTENT_WIDTH = 515;
export const CONTENT_HEIGHT = 762;

interface Size {
  width: number;
  height: number;
}

// An absolute length: a plain number, ignoring relative values like "100%".
function absoluteLength(value: string | null): number | null {
  const text = value?.trim();
  if (!text || text.endsWith("%")) return null;
  const length = Number.parseFloat(text);
  return Number.isFinite(length) && length > 0 ? length : null;
}

function viewBoxSize(el: Element): Size | null {
  const parts = el
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/);
  if (parts?.length !== 4) return null;
  const width = Number.parseFloat(parts[2]);
  const height = Number.parseFloat(parts[3]);
  if (!(Number.isFinite(width) && width > 0)) return null;
  if (!(Number.isFinite(height) && height > 0)) return null;
  return { width, height };
}

// The size pdfmake should lay the diagram out at, also written back onto the
// element. pdfmake measures an SVG from its width/height attributes and parses
// them with `parseFloat`, so Mermaid's `width="100%"` reads as 100: the diagram
// gets a 100-wide aspect ratio and spills across several near-empty pages. Fall
// back to the viewBox, which carries the real proportions, and write it back so
// pdfmake's own measurement agrees with ours.
function intrinsicSize(el: Element): Size | null {
  const width = absoluteLength(el.getAttribute("width"));
  const height = absoluteLength(el.getAttribute("height"));
  if (width && height) return { width, height };

  const viewBox = viewBoxSize(el);
  if (!viewBox) return null;
  el.setAttribute("width", String(viewBox.width));
  el.setAttribute("height", String(viewBox.height));
  return viewBox;
}

// Embed an <svg> element as a pdfmake vector node, scaled down to fit the page
// content box (a diagram taller than the page would otherwise overflow onto
// blank pages). Only the width is passed; pdfmake keeps the aspect ratio.
//
// An element mounted in the live document is passed through as-is: pdfmake then
// renders it with `useCSS`, so the browser resolves the diagram's own <style>
// block. Passing markup instead leaves the styling to svg-to-pdfkit's selector
// parser, which only matches a single compound selector and silently drops
// every descendant rule Mermaid and D2 emit (`.node rect`, `.edgePath .path`),
// painting the shapes with default fills. An element parsed into a standalone
// document (an SVG image decoded from a data: URL) is never laid out, so it has
// no computed style to read and goes as markup; `toXmlSvg` restores the
// namespace the sanitizer strips and hands the renderer well-formed XML.
export function svgNode(el: Element): Content {
  const size = intrinsicSize(el);
  const scale = size ? Math.min(1, CONTENT_WIDTH / size.width, CONTENT_HEIGHT / size.height) : 1;
  const svg = document.contains(el) ? (el as SVGElement) : toXmlSvg(el.outerHTML);
  return { svg, width: (size?.width ?? CONTENT_WIDTH) * scale, margin: [0, 0, 0, 8] };
}
