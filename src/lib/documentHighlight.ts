// Locates a quoted passage inside the rendered markdown viewer and flashes it,
// so the user can see which part of the document an AI reply refers to.
import { scrollBehavior } from "./reducedMotion";

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th";
const FLASH_CLASS = "ai-flash";
const FLASH_DURATION_MS = 2500;
// Quotes the model reworded slightly still locate via their opening chunk.
const PARTIAL_MATCH_CHARS = 60;

function normalize(text: string | null): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findBlock(container: Element, needle: string): Element | null {
  for (const block of container.querySelectorAll(BLOCK_SELECTOR)) {
    if (normalize(block.textContent).includes(needle)) return block;
  }
  return null;
}

/**
 * Scroll the viewer to the first block containing `text` (whitespace- and
 * case-insensitive, falling back to the quote's opening chunk) and flash it.
 * Returns false when the text isn't on screen, e.g. quotes the model made up.
 */
export function locateInDocument(text: string): boolean {
  const needle = normalize(text);
  if (!needle) return false;
  const container = document.querySelector(".markdown-body");
  if (!container) return false;

  const block =
    findBlock(container, needle) ??
    (needle.length > PARTIAL_MATCH_CHARS
      ? findBlock(container, needle.slice(0, PARTIAL_MATCH_CHARS))
      : null);
  if (!block) return false;

  for (const previous of container.querySelectorAll(`.${FLASH_CLASS}`)) {
    previous.classList.remove(FLASH_CLASS);
  }
  block.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  block.classList.add(FLASH_CLASS);
  window.setTimeout(() => block.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
  return true;
}

const LOCATE_ATTEMPTS = 20;
const LOCATE_INTERVAL_MS = 50;

// `locateInDocument` for a document that is still opening. The viewer emits no
// "rendered" signal, so this polls for one second and then gives up, which is
// also the right outcome for text that only exists in the source (a link
// target, a fence the renderer swallows).
export function locateWhenRendered(text: string): void {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    if (locateInDocument(text) || attempts >= LOCATE_ATTEMPTS) return;
    window.setTimeout(tick, LOCATE_INTERVAL_MS);
  };
  window.setTimeout(tick, LOCATE_INTERVAL_MS);
}
