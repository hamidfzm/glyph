// Plain-text projection of a canvas: the markdown of every text card plus
// group labels and link URLs, in document order. This feeds the features that
// read the active document's text — word count, AI actions, read aloud — so
// they work on the board's real content instead of raw JSON syntax.

import { parseCanvas } from "./parse";
import type { CanvasNode } from "./types";

function nodeText(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "group":
      return node.label ?? "";
    case "link":
      return node.url;
    default:
      return "";
  }
}

export function canvasDisplayText(content: string): string | null {
  try {
    const { nodes } = parseCanvas(content);
    const parts = nodes
      .map(nodeText)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}
