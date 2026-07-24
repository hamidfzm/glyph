// Intrinsic pixel size of an SVG document, read from its root `<svg>` tag:
// explicit width/height when both are plain pixel numbers, else the viewBox's
// width/height. Returns null when neither is usable (a dimensionless SVG).
//
// The image viewer uses this to give viewBox-only SVGs a real layout size: the
// webview reports `naturalWidth`/`naturalHeight` as 0 for them, which otherwise
// strands them in a contain-and-transform path that can't grow or pan on zoom.
export function svgIntrinsicSize(svg: string): { w: number; h: number } | null {
  if (typeof svg !== "string") return null;
  // Assumes no raw `>` inside a quoted attribute value on the root tag (SVG
  // exporters escape it); good enough for the markup we render.
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;

  const w = parseSvgLength(readAttr(tag, "width"));
  const h = parseSvgLength(readAttr(tag, "height"));
  if (w && h) return { w, h };

  const viewBox = readAttr(tag, "viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { w: parts[2], h: parts[3] };
    }
  }
  return null;
}

function readAttr(tag: string, name: string): string | null {
  // The lookbehind stops a bare `width` from matching inside `stroke-width`
  // (a plain `\b` treats the hyphen as a boundary).
  const match = tag.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3]) : null;
}

// Only bare numbers and explicit px are intrinsic pixels; percentages, em, etc.
// depend on context and don't give a real size.
function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d*\.?\d+)(px)?$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return n > 0 ? n : null;
}
