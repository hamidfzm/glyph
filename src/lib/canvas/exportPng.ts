// Captures the canvas board as a PNG. The world layer is re-rendered by
// html2canvas with its pan/zoom transform stripped, cropped to the nodes'
// bounding box plus breathing room, at 2x scale for crispness. Heavy
// html2canvas loads only when an export actually runs.

const PADDING = 48;

export async function exportCanvasPng(): Promise<Uint8Array | null> {
  const world = document.querySelector<HTMLElement>(".glyph-canvas-world");
  const stage = document.querySelector<HTMLElement>(".glyph-canvas-stage");
  if (!world || !stage) return null;

  // Bounding box of every node and group, in world coordinates. Layout uses
  // absolute left/top, so offsetLeft/offsetTop are the world positions.
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

  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(world, {
    backgroundColor: getComputedStyle(stage).backgroundColor,
    scale: 2,
    logging: false,
    x: minX - PADDING,
    y: minY - PADDING,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
    onclone: (doc) => {
      // Render the board untransformed so the crop window is world-space.
      const clone = doc.querySelector<HTMLElement>(".glyph-canvas-world");
      /* v8 ignore next -- defensive: the clone mirrors the live DOM queried above */
      if (clone) clone.style.transform = "none";
    },
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  /* v8 ignore next -- defensive: toBlob only yields null on canvas size overflow */
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
