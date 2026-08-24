// Locates a passage inside the rendered markdown viewer and flashes it: AI
// replies quote the document, and workspace search jumps to a matched line.
import { scrollBehavior } from "./reducedMotion";
import { DOCUMENT_SCROLLER, PREVIEW_SCROLLER } from "./scrollToHeading";

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th";
const FLASH_CLASS = "ai-flash";
const FLASH_DURATION_MS = 2500;
// Quotes the model reworded slightly still locate via their opening chunk.
const PARTIAL_MATCH_CHARS = 60;

function normalize(text: string | null): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// The viewer's rendered pane, not just any `.markdown-body` (AI replies and
// note embeds render one too); in split view the preview pane wins.
function documentContainer(): Element | null {
  return (
    document.querySelector(`${PREVIEW_SCROLLER} .markdown-body`) ??
    document.querySelector(`${DOCUMENT_SCROLLER} .markdown-body`)
  );
}

function findBlock(container: Element, needle: string): Element | null {
  for (const block of container.querySelectorAll(BLOCK_SELECTOR)) {
    if (normalize(block.textContent).includes(needle)) return block;
  }
  return null;
}

function flashBlock(container: Element, block: Element): void {
  for (const previous of container.querySelectorAll(`.${FLASH_CLASS}`)) {
    previous.classList.remove(FLASH_CLASS);
  }
  block.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  block.classList.add(FLASH_CLASS);
  window.setTimeout(() => block.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
}

/**
 * Scroll the viewer to the first block containing `text` (whitespace- and
 * case-insensitive, falling back to the quote's opening chunk) and flash it.
 * Returns false when the text isn't on screen, e.g. quotes the model made up.
 */
export function locateInDocument(text: string): boolean {
  const needle = normalize(text);
  if (!needle) return false;
  const container = documentContainer();
  if (!container) return false;

  const block =
    findBlock(container, needle) ??
    (needle.length > PARTIAL_MATCH_CHARS
      ? findBlock(container, needle.slice(0, PARTIAL_MATCH_CHARS))
      : null);
  if (!block) return false;

  flashBlock(container, block);
  return true;
}

/**
 * Scroll the viewer to the top-level block covering source `line` (the last
 * `data-line` marker at or above it, stamped by the pipeline) and flash it.
 * A pane rendered without markers falls back to matching `text`. Returns false
 * when neither locates, e.g. the line only exists in stripped frontmatter.
 */
export function locateLineInDocument(line: number, text: string): boolean {
  const container = documentContainer();
  if (!container) return false;

  let byLine: Element | null = null;
  for (const block of container.querySelectorAll("[data-line]")) {
    if (Number(block.getAttribute("data-line")) > line) break;
    byLine = block;
  }
  const block = byLine ?? findBlock(container, normalize(text));
  if (!block) return false;

  flashBlock(container, block);
  return true;
}

const LOCATE_ATTEMPTS = 20;
const LOCATE_INTERVAL_MS = 50;

/**
 * Run `locate` against a document that may still be opening. The viewer emits
 * no "rendered" signal, so this polls for a second, then reports failure via
 * `onFail`, which is also the right outcome for text that only exists in the
 * source (a link target, a fence the renderer swallows). Returns a cancel
 * function so a newer jump can abandon a pending one.
 */
export function locateWhenRendered(locate: () => boolean, onFail?: () => void): () => void {
  let cancelled = false;
  let attempts = 0;
  const tick = () => {
    if (cancelled) return;
    attempts += 1;
    if (locate()) {
      // The viewer restores a remembered scroll offset in a mount-time rAF;
      // re-run after it so the restore can't undo a jump that just landed.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) locate();
        });
      });
      return;
    }
    if (attempts >= LOCATE_ATTEMPTS) {
      onFail?.();
      return;
    }
    window.setTimeout(tick, LOCATE_INTERVAL_MS);
  };
  window.setTimeout(tick, LOCATE_INTERVAL_MS);
  return () => {
    cancelled = true;
  };
}
