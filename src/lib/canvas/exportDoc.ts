// Vector export sources for a canvas tab, built from the live board DOM.
//
// Two projections: `buildCanvasBoardHtml` keeps the spatial layout — a sized
// container with the world clone inside, edges svg and all — for the HTML
// export, where the app stylesheet travels along and renders it 1:1.
// `buildCanvasDocumentHtml` linearises the cards into a flowing article
// (group labels as headings, card markdown verbatim, links and files as
// paragraphs) for the DOCX/EPUB pipelines, which are documents, not boards.
// (The PDF export is spatial too — see exportModel.ts.) Both inline local
// images as data URIs so the output is portable.

import {
  BOARD_PADDING,
  CHROME_SELECTOR,
  inlineImages,
  measureBoard,
  syncCheckboxes,
} from "./boardDom";

/**
 * The board as a self-contained spatial fragment: a sized, clipped container
 * with the untransformed world clone positioned so every node (plus margin)
 * is visible. Pairs with the collected app CSS, which styles the cards,
 * edges, and colours exactly as on screen.
 */
export async function buildCanvasBoardHtml(): Promise<string | null> {
  const board = measureBoard();
  if (!board) return null;

  const clone = board.world.cloneNode(true) as HTMLElement;
  syncCheckboxes(board.world, clone);
  for (const el of clone.querySelectorAll(CHROME_SELECTOR)) el.remove();
  for (const el of clone.querySelectorAll("[data-selected]")) {
    el.removeAttribute("data-selected");
  }
  clone.style.transform = "none";
  clone.style.left = `${BOARD_PADDING - board.minX}px`;
  clone.style.top = `${BOARD_PADDING - board.minY}px`;
  // Cards scroll on the live board, but a static page should clip without
  // drawing scrollbars.
  for (const el of clone.querySelectorAll<HTMLElement>(".glyph-canvas-node-content")) {
    el.style.overflow = "hidden";
  }
  await inlineImages(clone);

  const container = document.createElement("div");
  container.className = "glyph-canvas-export";
  container.style.position = "relative";
  container.style.overflow = "hidden";
  container.style.width = `${board.width}px`;
  container.style.height = `${board.height}px`;
  container.style.backgroundColor = "var(--color-surface)";
  container.appendChild(clone);
  return container.outerHTML;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The board linearised into a flowing document, in board order: group labels
 * become headings, text cards contribute their rendered markdown verbatim,
 * link and file cards become paragraphs. Spatial information (positions,
 * connections) is the spatial HTML and PDF exports' job and is omitted here.
 */
export async function buildCanvasDocumentHtml(): Promise<string | null> {
  const board = measureBoard();
  if (!board) return null;

  const parts: string[] = [];
  const cards = board.world.querySelectorAll<HTMLElement>(
    ".glyph-canvas-node, .glyph-canvas-group",
  );
  for (const card of cards) {
    const groupLabel = card.querySelector(".glyph-canvas-node-group-label")?.textContent?.trim();
    if (groupLabel) {
      parts.push(`<h2>${escapeHtml(groupLabel)}</h2>`);
      continue;
    }
    const text = card.querySelector(".glyph-canvas-node-text");
    if (text) {
      const copy = text.cloneNode(true) as Element;
      syncCheckboxes(text, copy);
      parts.push(`<section>${copy.innerHTML}</section>`);
      continue;
    }
    const link = card.querySelector<HTMLElement>(".glyph-canvas-node-link");
    const url = link?.getAttribute("title");
    if (url) {
      parts.push(`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`);
      continue;
    }
    const image = card.querySelector("img.glyph-canvas-node-image");
    if (image) {
      parts.push(`<p>${image.outerHTML}</p>`);
      continue;
    }
    const file = card.querySelector(".glyph-canvas-node-file")?.getAttribute("title");
    if (file) parts.push(`<p>${escapeHtml(file)}</p>`);
  }
  if (parts.length === 0) return null;

  const root = document.createElement("div");
  root.innerHTML = parts.join("\n<hr />\n");
  await inlineImages(root);
  return root.innerHTML;
}
