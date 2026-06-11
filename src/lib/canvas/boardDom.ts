// Shared DOM helpers for reading the live canvas board during exports. The
// HTML, document, and PDF exporters all measure the same world element, strip
// the same editor chrome, and need the same fixes for state that lives in DOM
// properties rather than attributes.

export const BOARD_PADDING = 48;

/** Editor chrome that must never appear in an export. */
export const CHROME_SELECTOR =
  ".glyph-canvas-connector, .glyph-canvas-resize, .glyph-canvas-node-editor, .glyph-canvas-edge-label-editor, .glyph-canvas-edge-hit, .glyph-canvas-temp-edge";

export interface Board {
  world: HTMLElement;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function measureBoard(): Board | null {
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
    width: maxX - minX + BOARD_PADDING * 2,
    height: maxY - minY + BOARD_PADDING * 2,
  };
}

/**
 * Copy live checkbox state onto a clone's attributes, and disable the clones.
 * React drives the `checked` DOM property, but serialization (cloneNode,
 * innerHTML) reads the attribute, which goes stale after the first toggle.
 * Exported checkboxes are also inert — a static page can't write the toggle
 * back to the .canvas file, so an editable-looking box would lie.
 */
export function syncCheckboxes(live: Element, clone: Element): void {
  const liveBoxes = live.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  const cloneBoxes = clone.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  liveBoxes.forEach((box, i) => {
    const target = cloneBoxes[i];
    /* v8 ignore start -- defensive: the clone mirrors the live tree, so the lists always pair up */
    if (!target) return;
    /* v8 ignore stop */
    if (box.checked) target.setAttribute("checked", "");
    else target.removeAttribute("checked");
    target.setAttribute("disabled", "");
  });
}

/** Replace local image sources with data URIs so the export stands alone. */
export async function inlineImages(root: HTMLElement): Promise<void> {
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
