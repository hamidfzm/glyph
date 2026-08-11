/** A rendered block's source line paired with its offset in the preview scroller. */
export interface ScrollAnchor {
  line: number;
  top: number;
}

// Both directions interpolate between the two anchors bracketing the query and
// clamp outside the outermost pair, so the gaps left by blocks that carry no
// marker (a Mermaid diagram, a CSV table) map through their neighbours instead
// of snapping. Anchors arrive in document order, which is line order.

function interpolate(from: number, to: number, fromSpan: number, toSpan: number, into: number) {
  if (fromSpan <= 0) return to;
  return to + ((into - from) / fromSpan) * toSpan;
}

/** The preview offset showing `line`, or null when the document has no anchors. */
export function offsetForLine(anchors: readonly ScrollAnchor[], line: number): number | null {
  if (anchors.length === 0) return null;
  const first = anchors[0];
  if (line <= first.line) return first.top;
  const last = anchors[anchors.length - 1];
  if (line >= last.line) return last.top;

  for (let i = 0; i < anchors.length - 1; i++) {
    const lower = anchors[i];
    const upper = anchors[i + 1];
    if (line < lower.line || line >= upper.line) continue;
    return interpolate(lower.line, lower.top, upper.line - lower.line, upper.top - lower.top, line);
  }
  return last.top;
}

/** The source line showing at preview offset `top`, or null without anchors. */
export function lineForOffset(anchors: readonly ScrollAnchor[], top: number): number | null {
  if (anchors.length === 0) return null;
  const first = anchors[0];
  if (top <= first.top) return first.line;
  const last = anchors[anchors.length - 1];
  if (top >= last.top) return last.line;

  for (let i = 0; i < anchors.length - 1; i++) {
    const lower = anchors[i];
    const upper = anchors[i + 1];
    if (top < lower.top || top >= upper.top) continue;
    return interpolate(lower.top, lower.line, upper.top - lower.top, upper.line - lower.line, top);
  }
  return last.line;
}
