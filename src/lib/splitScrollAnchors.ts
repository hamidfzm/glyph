/** A rendered block's source line paired with its offset in the preview scroller. */
export interface ScrollAnchor {
  line: number;
  top: number;
}

// Both directions interpolate between the two anchors bracketing the query and
// clamp outside the outermost pair, so the gaps left by blocks that carry no
// marker (a Mermaid diagram, a CSV table) map through their neighbours instead
// of snapping. Anchors arrive in document order, which is line order.

function lerp(fromLow: number, fromHigh: number, toLow: number, toHigh: number, at: number) {
  return toLow + ((at - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow);
}

/** The preview offset showing `line`, or null when the document has no anchors. */
export function offsetForLine(anchors: readonly ScrollAnchor[], line: number): number | null {
  if (anchors.length === 0) return null;
  const first = anchors[0];
  if (line <= first.line) return first.top;
  const last = anchors[anchors.length - 1];
  if (line >= last.line) return last.top;

  // The clamps leave the query strictly inside the range, so a bracketing pair
  // always exists and its span is never zero.
  const at = anchors.findIndex((anchor) => anchor.line > line);
  const before = anchors[at - 1];
  const after = anchors[at];
  return lerp(before.line, after.line, before.top, after.top, line);
}

/** The source line showing at preview offset `top`, or null without anchors. */
export function lineForOffset(anchors: readonly ScrollAnchor[], top: number): number | null {
  if (anchors.length === 0) return null;
  const first = anchors[0];
  if (top <= first.top) return first.line;
  const last = anchors[anchors.length - 1];
  if (top >= last.top) return last.line;

  const at = anchors.findIndex((anchor) => anchor.top > top);
  const before = anchors[at - 1];
  const after = anchors[at];
  return lerp(before.top, after.top, before.line, after.line, top);
}
