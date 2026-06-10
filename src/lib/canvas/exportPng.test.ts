import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportCanvasPng } from "./exportPng";

// html2canvas is heavy; the export loads it dynamically, so the mock keeps the
// real library out of the test run entirely.
const html2canvasMock = vi.fn();
vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvasMock(...args),
}));

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

function fakeCanvas(bytes: Uint8Array<ArrayBuffer>) {
  return {
    toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob([bytes])),
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

  it("strips the pan/zoom transform from the cloned world via onclone", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });

    await exportCanvasPng();

    const [, options] = html2canvasMock.mock.calls[0] as [unknown, FakeCanvasOptions["options"]];
    const clone = document.createElement("div");
    clone.className = "glyph-canvas-world";
    clone.style.transform = "translate(40px, 60px) scale(1.5)";
    options.onclone({ querySelector: () => clone } as unknown as Document);
    expect(clone.style.transform).toBe("none");
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

  it("returns null when the canvas produces no blob", async () => {
    const { world } = buildBoard();
    addBox(world, "glyph-canvas-node", { left: 0, top: 0, width: 10, height: 10 });
    html2canvasMock.mockResolvedValue({
      toBlob: (cb: (blob: Blob | null) => void) => cb(null),
    });

    expect(await exportCanvasPng()).toBeNull();
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
