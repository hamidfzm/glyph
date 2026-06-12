// A renderer-neutral snapshot of the live canvas board, with every CSS
// variable and class resolved to concrete values. The PDF export consumes it
// to redraw the board with vector primitives — it can't load the app
// stylesheet the way the HTML export does, so colours, positions, and the
// edges svg must arrive self-contained.

import { BOARD_PADDING, inlineImages, measureBoard, syncCheckboxes } from "./boardDom";

export interface BoardCard {
  kind: "group" | "card";
  /** Geometry relative to the export origin (board top-left incl. margin). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Resolved CSS border colour, as computed (rgb/rgba string). */
  borderColor: string;
  /** Always the light palette — a PDF is paper, whatever the app theme. */
  background: string;
  /** Group label, when the group has one. */
  label?: string;
  /** Rendered markdown HTML for text cards. */
  html?: string;
  /** Link cards: the URL; file cards: the display name. */
  linkUrl?: string;
  fileName?: string;
}

export interface CanvasBoardModel {
  width: number;
  height: number;
  cards: BoardCard[];
  /** Self-contained svg of all edges (baked attributes, no CSS classes). */
  edgesSvg: string;
}

const FALLBACKS = {
  stroke: "#8e8e93",
  labelFill: "#636366",
  border: "rgb(200, 200, 205)",
};

// The converted card text renders in document colours (dark on light), so
// backgrounds must stay light even when the app itself is in dark mode.
const CARD_BG = "#ffffff";
const GROUP_BG = "#f2f2f4";

function resolved(value: string | undefined, fallback: string): string {
  return value && value !== "none" && value !== "" ? value : fallback;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Re-emit the live edges svg with all styling baked into attributes. The
 * paths stay in world coordinates; the viewBox shifts them into the export
 * frame, so no coordinate rewriting is needed.
 */
function bakeEdgesSvg(world: HTMLElement, viewBox: string, w: number, h: number): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">`,
  ];
  const svg = world.querySelector(".glyph-canvas-edges");
  for (const path of svg?.querySelectorAll("path:not(.glyph-canvas-edge-hit)") ?? []) {
    const cs = getComputedStyle(path);
    const stroke = resolved(cs.stroke, FALLBACKS.stroke);
    const width = resolved(cs.strokeWidth, "2").replace("px", "");
    /* v8 ignore start -- defensive: every rendered edge path carries a d attribute */
    const d = path.getAttribute("d") ?? "";
    /* v8 ignore stop */
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`);
  }
  for (const poly of svg?.querySelectorAll("polygon") ?? []) {
    const fill = resolved(getComputedStyle(poly).fill, FALLBACKS.stroke);
    /* v8 ignore start -- defensive: every rendered arrowhead carries its points */
    const points = poly.getAttribute("points") ?? "";
    /* v8 ignore stop */
    parts.push(`<polygon points="${points}" fill="${fill}"/>`);
  }
  for (const text of svg?.querySelectorAll("text") ?? []) {
    const cs = getComputedStyle(text);
    const fill = resolved(cs.fill, FALLBACKS.labelFill);
    const size = resolved(cs.fontSize, "12px").replace("px", "");
    /* v8 ignore start -- defensive: a connected element's textContent is never null */
    const label = escapeXml(text.textContent ?? "");
    /* v8 ignore stop */
    parts.push(
      `<text x="${text.getAttribute("x") ?? "0"}" y="${text.getAttribute("y") ?? "0"}" ` +
        `text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${fill}">` +
        `${label}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/**
 * The rendered markdown of a text card, with checkbox inputs replaced by
 * `[x]`/`[ ]` markers — the PDF converter has no widget for an `<input>`, and
 * the PDF's built-in font has no glyph for ☑/☐, so ASCII markers are the only
 * form that both survives conversion and always renders.
 */
async function cardHtml(text: Element): Promise<string> {
  const copy = text.cloneNode(true) as HTMLElement;
  syncCheckboxes(text, copy);
  for (const box of copy.querySelectorAll("input[type=checkbox]")) {
    // The surrounding list item already has a space after the input.
    box.replaceWith(document.createTextNode(box.hasAttribute("checked") ? "[x]" : "[ ]"));
  }
  await inlineImages(copy);
  return copy.innerHTML;
}

/** Snapshot the live board for the spatial PDF export; null when no board. */
export async function buildCanvasBoardModel(): Promise<CanvasBoardModel | null> {
  const board = measureBoard();
  if (!board) return null;

  const originX = board.minX - BOARD_PADDING;
  const originY = board.minY - BOARD_PADDING;
  const cards: BoardCard[] = [];
  const boxes = board.world.querySelectorAll<HTMLElement>(
    ".glyph-canvas-group, .glyph-canvas-node",
  );
  for (const el of boxes) {
    const isGroup = el.classList.contains("glyph-canvas-group");
    const cs = getComputedStyle(el);
    const card: BoardCard = {
      kind: isGroup ? "group" : "card",
      x: el.offsetLeft - originX,
      y: el.offsetTop - originY,
      width: el.offsetWidth,
      height: el.offsetHeight,
      borderColor: resolved(cs.borderTopColor, FALLBACKS.border),
      background: isGroup ? GROUP_BG : CARD_BG,
    };
    const label = el.querySelector(".glyph-canvas-node-group-label")?.textContent?.trim();
    if (label) card.label = label;
    const text = el.querySelector(".glyph-canvas-node-text");
    if (text) card.html = await cardHtml(text);
    const url = el.querySelector(".glyph-canvas-node-link")?.getAttribute("title");
    if (url) card.linkUrl = url;
    const file = el.querySelector(".glyph-canvas-node-file")?.getAttribute("title");
    if (file) {
      /* v8 ignore start -- defensive: splitting a non-empty string always yields a last segment */
      card.fileName = file.split(/[/\\]/).pop() ?? file;
      /* v8 ignore stop */
    }
    cards.push(card);
  }

  return {
    width: board.width,
    height: board.height,
    cards,
    edgesSvg: bakeEdgesSvg(
      board.world,
      `${originX} ${originY} ${board.width} ${board.height}`,
      board.width,
      board.height,
    ),
  };
}
