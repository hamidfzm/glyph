// Vector export sources for a canvas tab, built from the live board DOM.
//
// Two projections: `buildCanvasBoardHtml` keeps the spatial layout — a sized
// container with the world clone inside, edges svg and all — for the HTML
// export, where the app stylesheet travels along and renders it 1:1.
// `buildCanvasDocumentHtml` linearises the cards into a flowing article
// (group labels as headings, card markdown verbatim, links and files as
// paragraphs) for the PDF/DOCX/EPUB pipelines, which are documents, not
// boards. Both inline local images as data URIs so the output is portable.

const PADDING = 48;

/** Editor chrome that must never appear in an export. */
const CHROME_SELECTOR =
  ".glyph-canvas-connector, .glyph-canvas-resize, .glyph-canvas-node-editor, .glyph-canvas-edge-label-editor, .glyph-canvas-edge-hit, .glyph-canvas-temp-edge";

interface Board {
  world: HTMLElement;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function measureBoard(): Board | null {
  const world = document.querySelector<HTMLElement>(".glyph-canvas-world");
  if (!world) return null;
  const boxes = world.querySelectorAll<HTMLElement>(".glyph-canvas-node, .glyph-canvas-group");
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of boxes) {
    minX = Math.min(minX, el.offsetLeft);
    minY = Math.min(minY, el.offsetTop);
    maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
    maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
  }
  return {
    world,
    minX,
    minY,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  };
}

/**
 * Copy live checkbox state onto a clone's attributes. React drives the
 * `checked` DOM property, but serialization (cloneNode, innerHTML) reads the
 * attribute, which goes stale after the first toggle — without this, exports
 * would show every task list as it looked when the card first rendered.
 */
function syncCheckboxes(live: Element, clone: Element): void {
  const liveBoxes = live.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  const cloneBoxes = clone.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  liveBoxes.forEach((box, i) => {
    const target = cloneBoxes[i];
    /* v8 ignore start -- defensive: the clone mirrors the live tree, so the lists always pair up */
    if (!target) return;
    /* v8 ignore stop */
    if (box.checked) target.setAttribute("checked", "");
    else target.removeAttribute("checked");
  });
}

/** Replace local image sources with data URIs so the export stands alone. */
async function inlineImages(root: HTMLElement): Promise<void> {
  const images = root.querySelectorAll("img");
  await Promise.all(
    Array.from(images).map(async (img) => {
      const src = img.getAttribute("src");
      // Already-portable sources stay; everything local — including Tauri's
      // `asset.localhost` protocol URLs — gets embedded.
      if (!src || /^data:/i.test(src)) return;
      if (/^https?:/i.test(src) && !/^https?:\/\/asset\.localhost\//i.test(src)) return;
      try {
        const blob = await (await fetch(src)).blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", dataUrl);
      } catch {
        // Unreadable image: drop it rather than embedding a broken reference.
        img.remove();
      }
    }),
  );
}

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
  clone.style.left = `${PADDING - board.minX}px`;
  clone.style.top = `${PADDING - board.minY}px`;
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
 * connections) is the spatial HTML export's job and is omitted here.
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
