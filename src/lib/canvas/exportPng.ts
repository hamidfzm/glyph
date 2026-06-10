// Captures the canvas board as a PNG. The world layer is re-rendered by
// html2canvas with its pan/zoom transform stripped, cropped to the nodes'
// bounding box plus breathing room, at 2x scale for crispness. Heavy
// html2canvas loads only when an export actually runs.
//
// Edges are not captured by html2canvas: its inline-SVG rasterization fails
// silently for the edges overlay (CSS-variable strokes, zero-sized root with
// overflow drawing). Instead the svg is dropped from the clone and its
// primitives — bezier paths, arrowhead polygons, label text — are replayed
// directly onto the output canvas, with colors the browser already resolved.

const SCALE = 2;
const PADDING = 48;

function drawEdges(ctx: CanvasRenderingContext2D, world: HTMLElement): void {
  for (const svg of world.querySelectorAll(".glyph-canvas-edges")) {
    for (const el of svg.querySelectorAll("path, polygon, text")) {
      // The widened invisible hit-target is editor chrome, not board content.
      if (el.classList.contains("glyph-canvas-edge-hit")) continue;
      const cs = getComputedStyle(el);
      if (el.tagName === "path") {
        const d = el.getAttribute("d");
        /* v8 ignore start -- defensive: every rendered edge path carries a d attribute */
        if (!d) continue;
        /* v8 ignore stop */
        ctx.lineWidth = Number(el.getAttribute("stroke-width")) || 2;
        ctx.strokeStyle = cs.stroke;
        ctx.stroke(new Path2D(d));
      } else if (el.tagName === "polygon") {
        /* v8 ignore start -- defensive: arrowhead polygons always carry points */
        const points = (el.getAttribute("points") ?? "")
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number));
        /* v8 ignore stop */
        /* v8 ignore start -- defensive: arrowheads are always three points */
        if (points.length < 3) continue;
        /* v8 ignore stop */
        ctx.fillStyle = cs.fill;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = cs.fill;
        ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          /* v8 ignore next -- defensive: textContent of an element is never null */
          el.textContent ?? "",
          Number(el.getAttribute("x")),
          Number(el.getAttribute("y")),
        );
      }
    }
  }
}

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

  const crop = {
    x: minX - PADDING,
    y: minY - PADDING,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  };

  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(world, {
    backgroundColor: getComputedStyle(stage).backgroundColor,
    scale: SCALE,
    logging: false,
    ...crop,
    onclone: (doc) => {
      // Render the board untransformed so the crop window is world-space.
      const clone = doc.querySelector<HTMLElement>(".glyph-canvas-world");
      /* v8 ignore next -- defensive: the clone mirrors the live DOM queried above */
      if (!clone) return;
      clone.style.transform = "none";
      // The image is the board, not the editing session: drop selection
      // chrome, connectors, resize handles, any open inline editor — and the
      // edges svg, which is replayed onto the canvas afterwards instead.
      const dropped = clone.querySelectorAll(
        ".glyph-canvas-connector, .glyph-canvas-resize, .glyph-canvas-node-editor, .glyph-canvas-edge-label-editor, .glyph-canvas-edges",
      );
      for (const el of dropped) el.remove();
      for (const el of clone.querySelectorAll("[data-selected]")) {
        el.removeAttribute("data-selected");
      }
    },
  });

  const ctx = canvas.getContext("2d");
  /* v8 ignore start -- defensive: a 2d context is always available on the capture canvas */
  if (!ctx) return null;
  /* v8 ignore stop */
  ctx.save();
  // Absolute transform: html2canvas leaves its own scale on the context, so
  // a relative scale/translate would compound it and throw the edges off
  // the bitmap entirely.
  ctx.setTransform(SCALE, 0, 0, SCALE, -crop.x * SCALE, -crop.y * SCALE);
  drawEdges(ctx, world);
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) return new Uint8Array(await blob.arrayBuffer());

  // toBlob hands back null under memory pressure (observed in WebView2 on a
  // busy machine). The synchronous data-URL path allocates differently and
  // usually still succeeds, so try it before giving up.
  const base64 = canvas.toDataURL("image/png").split(",")[1];
  /* v8 ignore start -- defensive: toDataURL always yields a data: prefix with a payload */
  if (!base64) return null;
  /* v8 ignore stop */
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
