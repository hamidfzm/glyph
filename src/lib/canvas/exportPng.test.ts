import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportCanvasPng } from "./exportPng";

// html2canvas is heavy; the export loads it dynamically, so the mock keeps the
// real library out of the test run entirely.
const html2canvasMock = vi.fn();
vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvasMock(...args),
}));

// happy-dom has no Path2D; the replay constructs one per edge path.
class FakePath2D {
  d: string;
  constructor(d: string) {
    this.d = d;
  }
}
vi.stubGlobal("Path2D", FakePath2D);

interface FakeCanvasOptions {
  element: HTMLElement;
  options: {
    scale: number;
    x: number;
    y: number;
    width: number;
    height: number;
    onclone: (doc: Pick<Document, "querySelector">) => void;
  };
}

/** A recording 2d context capturing the edge-replay drawing calls. */
function fakeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
}

function fakeCanvas(bytes: Uint8Array<ArrayBuffer>) {
  const ctx = fakeContext();
  return {
    ctx,
    getContext: () => ctx,
    toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob([bytes])),
    toDataURL: () => "data:image/png;base64,",
  };
}

/** Append a node/group to the world with explicit offset geometry. happy-dom
 * performs no layout, so offsetLeft/offsetWidth are defined directly. */
function addBox(
  world: HTMLElement,
  className: string,
  box: { left: number; top: number; width: number; height: number },
): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  Object.defineProperty(el, "offsetLeft", { value: box.left });
  Object.defineProperty(el, "offsetTop", { value: box.top });
  Object.defineProperty(el, "offsetWidth", { value: box.width });
  Object.defineProperty(el, "offsetHeight", { value: box.height });
  world.appendChild(el);
  return el;
}

/** An edges overlay with one visible path, a hit path, an arrowhead, a label. */
function addEdgesSvg(world: HTMLElement): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "glyph-canvas-edges");
  const visible = document.createElementNS(ns, "path");
  visible.setAttribute("d", "M 0 0 C 10 10, 20 20, 30 30");
  visible.setAttribute("stroke-width", "2");
  const hit = document.createElementNS(ns, "path");
  hit.setAttribute("class", "glyph-canvas-edge-hit");
  hit.setAttribute("d", "M 0 0 C 10 10, 20 20, 30 30");
  const arrow = document.createElementNS(ns, "polygon");
  arrow.setAttribute("points", "30,30 25,21 35,21");
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "15");
  label.setAttribute("y", "15");
  label.textContent = "spec";
  svg.append(hit, visible, arrow, label);
  world.appendChild(svg);
  return svg;
}

function buildBoard(): { stage: HTMLElement; world: HTMLElement } {
  const stage = document.createElement("div");
  stage.className = "glyph-canvas-stage";
  const world = document.createElement("div");
  world.className = "glyph-canvas-world";
  stage.appendChild(world);
  document.body.appendChild(stage);
  return { stage, world };
}

beforeEach(() => {
  html2canvasMock.mockReset().mockResolvedValue(fakeCanvas(new Uint8Array([1, 2, 3])));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("exportCanvasPng", () => {
  it("renders the world at 2x cropped to the nodes' bounding box plus padding", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 100, top: 200, width: 300, height: 150 });
    addBox(world, "glyph-canvas-node", { left: 500, top: 400, width: 200, height: 100 });

    const bytes = await exportCanvasPng();

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    const [element, options] = html2canvasMock.mock.calls[0] as [
      FakeCanvasOptions["element"],
      FakeCanvasOptions["options"],
    ];
    expect(element).toBe(world);
    // Bounding box is (100,200)-(700,500); the crop adds 48px on every side.
    expect(options).toMatchObject({
      scale: 2,
      x: 100 - 48,
      y: 200 - 48,
      width: 600 + 96,
      height: 300 + 96,
    });
  });

  it("includes groups in the bounding box", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 100, top: 100, width: 100, height: 100 });
    addBox(world, "glyph-canvas-group", { left: 0, top: 0, width: 400, height: 400 });

    await exportCanvasPng();

    const [, options] = html2canvasMock.mock.calls[0] as [unknown, FakeCanvasOptions["options"]];
    expect(options).toMatchObject({ x: -48, y: -48, width: 400 + 96, height: 400 + 96 });
  });

  it("strips the transform and editor chrome from the clone, dropping the edges svg", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });

    await exportCanvasPng();

    const [, options] = html2canvasMock.mock.calls[0] as [unknown, FakeCanvasOptions["options"]];
    // A real-DOM clone: world with chrome, an edges svg, and a selected node.
    const clone = document.createElement("div");
    clone.className = "glyph-canvas-world";
    clone.style.transform = "translate(40px, 60px) scale(1.5)";
    const selected = document.createElement("div");
    selected.className = "glyph-canvas-node";
    selected.setAttribute("data-selected", "true");
    const connector = document.createElement("span");
    connector.className = "glyph-canvas-connector";
    selected.appendChild(connector);
    clone.appendChild(selected);
    addEdgesSvg(clone);

    options.onclone({ querySelector: () => clone } as unknown as Document);

    expect(clone.style.transform).toBe("none");
    expect(clone.querySelector(".glyph-canvas-edges")).toBeNull();
    expect(clone.querySelector(".glyph-canvas-connector")).toBeNull();
    expect(selected.hasAttribute("data-selected")).toBe(false);
  });

  it("tolerates a clone document without a world element", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });

    await exportCanvasPng();

    const [, options] = html2canvasMock.mock.calls[0] as [unknown, FakeCanvasOptions["options"]];
    expect(() =>
      options.onclone({ querySelector: () => null } as unknown as Document),
    ).not.toThrow();
  });

  it("replays the edges onto the capture with an absolute transform", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 100, top: 200, width: 300, height: 150 });
    addEdgesSvg(world);
    const canvas = fakeCanvas(new Uint8Array([9]));
    html2canvasMock.mockResolvedValue(canvas);

    await exportCanvasPng();

    const { ctx } = canvas;
    // Crop origin is (52, 152); the absolute transform maps world space onto
    // the 2x bitmap regardless of any state html2canvas left behind.
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -52 * 2, -152 * 2);
    // One visible path stroked (the widened hit path is editor chrome).
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect((ctx.stroke.mock.calls[0][0] as FakePath2D).d).toBe("M 0 0 C 10 10, 20 20, 30 30");
    expect(ctx.lineWidth).toBe(2);
    // The arrowhead polygon fills its three points.
    expect(ctx.moveTo).toHaveBeenCalledWith(30, 30);
    expect(ctx.lineTo).toHaveBeenCalledWith(25, 21);
    expect(ctx.lineTo).toHaveBeenCalledWith(35, 21);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    // The label text lands on the edge midpoint.
    expect(ctx.fillText).toHaveBeenCalledWith("spec", 15, 15);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("defaults the line width when an edge path has no stroke-width", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "glyph-canvas-edges");
    const bare = document.createElementNS(ns, "path");
    bare.setAttribute("d", "M 0 0 C 1 1, 2 2, 3 3");
    svg.appendChild(bare);
    world.appendChild(svg);
    const canvas = fakeCanvas(new Uint8Array([7]));
    html2canvasMock.mockResolvedValue(canvas);

    await exportCanvasPng();

    expect(canvas.ctx.lineWidth).toBe(2);
    expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("falls back to the data-URL path when toBlob yields null", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });
    const ctx = fakeContext();
    html2canvasMock.mockResolvedValue({
      getContext: () => ctx,
      toBlob: (cb: (blob: Blob | null) => void) => cb(null),
      toDataURL: () => `data:image/png;base64,${btoa("abc")}`,
    });

    expect(await exportCanvasPng()).toEqual(new Uint8Array([97, 98, 99]));
  });

  it("returns null when no canvas world is on screen", async () => {
    expect(await exportCanvasPng()).toBeNull();
    expect(html2canvasMock).not.toHaveBeenCalled();
  });

  it("returns null when the world exists without a stage", async () => {
    const world = document.createElement("div");
    world.className = "glyph-canvas-world";
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });
    document.body.appendChild(world);

    expect(await exportCanvasPng()).toBeNull();
    expect(html2canvasMock).not.toHaveBeenCalled();
  });

  it("returns null for an empty board with nothing to crop to", async () => {
    buildBoard();
    expect(await exportCanvasPng()).toBeNull();
    expect(html2canvasMock).not.toHaveBeenCalled();
  });
});
