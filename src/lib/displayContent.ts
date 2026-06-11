// What the text-consuming features see for the active document, derived from
// the file type. `displayContentFor` feeds word count, AI actions, and read
// aloud; `tocContentFor` feeds the outline.

import { canvasDisplayText } from "./canvas/canvasText";
import { isCanvasFile } from "./canvasExtensions";
import { isNotebookFile } from "./notebookExtensions";

/**
 * Markdown passes through as-is. Notebooks suppress entirely — their raw
 * `.ipynb` JSON is worse than nothing. Canvases are JSON too, but their boards
 * carry real prose, so the text cards, group labels, and link URLs are
 * projected instead of the syntax.
 */
export function displayContentFor(path: string | undefined, live: string | null): string | null {
  if (!path) return live;
  if (isNotebookFile(path)) return null;
  if (isCanvasFile(path)) return live ? canvasDisplayText(live) : null;
  return live;
}

/**
 * Outline entries navigate by scrolling the document to a heading. A canvas
 * board has no heading scroll targets, so its outline stays empty even though
 * its projected text may contain headings.
 */
export function tocContentFor(path: string | undefined, display: string | null): string | null {
  return path && isCanvasFile(path) ? null : display;
}
