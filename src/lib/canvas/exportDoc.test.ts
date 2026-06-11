import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanvasBoardHtml, buildCanvasDocumentHtml } from "./exportDoc";

// happy-dom reports zero offsets, so each node gets explicit offset geometry.
function addBox(world: HTMLElement, className: string, rect: [number, number, number, number]) {
  const el = document.createElement("div");
  el.className = className;
  Object.defineProperties(el, {
    offsetLeft: { value: rect[0] },
    offsetTop: { value: rect[1] },
    offsetWidth: { value: rect[2] },
    offsetHeight: { value: rect[3] },
  });
  world.appendChild(el);
  return el;
}

function mountWorld(): HTMLElement {
  const world = document.createElement("div");
  world.className = "glyph-canvas-world";
  document.body.appendChild(world);
  return world;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("buildCanvasBoardHtml", () => {
  it("returns null when no board is mounted", async () => {
    expect(await buildCanvasBoardHtml()).toBeNull();
  });

  it("returns null when the board has no nodes", async () => {
    mountWorld();
    expect(await buildCanvasBoardHtml()).toBeNull();
  });

  it("sizes the container to the node bounding box plus padding", async () => {
    const world = mountWorld();
    addBox(world, "glyph-canvas-node", [100, 50, 200, 80]);
    addBox(world, "glyph-canvas-group", [-20, 300, 150, 100]);

    const html = await buildCanvasBoardHtml();
    // x spans -20..300, y spans 50..400 → 320×350 plus 48px padding each side.
    expect(html).toContain("width: 416px");
    expect(html).toContain("height: 446px");
    // The world clone is shifted so the top-left node lands inside the margin.
    expect(html).toContain("left: 68px");
    expect(html).toContain("top: -2px");
    expect(html).toContain("transform: none");
  });

  it("clips card content instead of exporting scrollbars", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML = '<div class="glyph-canvas-node-content" style="overflow: auto">x</div>';

    const html = (await buildCanvasBoardHtml()) ?? "";
    expect(html).toContain("overflow: hidden");
  });

  it("strips editor chrome and selection state from the clone", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.setAttribute("data-selected", "true");
    node.innerHTML =
      '<span class="glyph-canvas-connector"></span><span class="glyph-canvas-resize"></span>' +
      '<textarea class="glyph-canvas-node-editor"></textarea><p>keep</p>';

    const html = await buildCanvasBoardHtml();
    expect(html).toContain("keep");
    expect(html).not.toContain("glyph-canvas-connector");
    expect(html).not.toContain("glyph-canvas-resize");
    expect(html).not.toContain("glyph-canvas-node-editor");
    expect(html).not.toContain("data-selected");
  });

  it("inlines local images as data URIs and keeps remote ones", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML =
      '<img src="http://asset.localhost/pic.png" /><img src="https://x.dev/web.png" />';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["img-bytes"])) }),
    );

    const html = await buildCanvasBoardHtml();
    expect(html).toContain('src="data:');
    expect(html).toContain('src="https://x.dev/web.png"');
  });

  it("leaves data URIs and srcless images untouched", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML = '<img src="data:image/png;base64,AAAA" /><img />';
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const html = (await buildCanvasBoardHtml()) ?? "";
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it("drops images whose bytes cannot be read back", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML = '<img src="http://asset.localhost/corrupt.png" />';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"])) }),
    );
    class FailingReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new Error("read failed");
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("FileReader", FailingReader);

    const html = await buildCanvasBoardHtml();
    expect(html).not.toContain("<img");
  });

  it("drops images whose source cannot be read", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML = '<img src="http://asset.localhost/missing.png" />';
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("gone")));

    const html = await buildCanvasBoardHtml();
    expect(html).not.toContain("<img");
  });
});

describe("checkbox state sync", () => {
  // React drives the `checked` property; cloneNode/innerHTML serialize the
  // attribute, which goes stale after the first toggle.
  it("board export reflects live checkbox properties, not stale attributes", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML =
      '<input type="checkbox" checked /><input type="checkbox" /><input type="checkbox" />';
    const [a, b] = Array.from(node.querySelectorAll("input"));
    a.checked = false; // attribute says checked, property says not
    b.checked = true; // attribute absent, property checked

    const html = (await buildCanvasBoardHtml()) ?? "";
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0].includes("checked"));
    expect(inputs).toEqual([false, true, false]);
  });

  it("exports checkboxes disabled — a static page cannot persist a toggle", async () => {
    const world = mountWorld();
    const node = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    node.innerHTML =
      '<div class="glyph-canvas-node-text markdown-body"><input type="checkbox" /></div>';

    const board = (await buildCanvasBoardHtml()) ?? "";
    const doc = (await buildCanvasDocumentHtml()) ?? "";
    expect(board).toMatch(/<input[^>]*disabled/);
    expect(doc).toMatch(/<input[^>]*disabled/);
  });

  it("document export reflects live checkbox properties too", async () => {
    const world = mountWorld();
    const card = addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    card.innerHTML =
      '<div class="glyph-canvas-node-text markdown-body"><input type="checkbox" /></div>';
    card.querySelector("input")!.checked = true;

    const html = (await buildCanvasDocumentHtml()) ?? "";
    expect(html).toContain("checked");
  });
});

describe("buildCanvasDocumentHtml", () => {
  it("returns null when no board is mounted", async () => {
    expect(await buildCanvasDocumentHtml()).toBeNull();
  });

  it("linearises groups, text, links, images, and files in board order", async () => {
    const world = mountWorld();
    const group = addBox(world, "glyph-canvas-group", [0, 0, 400, 300]);
    group.innerHTML = '<div class="glyph-canvas-node-group-label">Ideas &amp; plans</div>';
    const text = addBox(world, "glyph-canvas-node", [10, 10, 200, 80]);
    text.innerHTML = '<div class="glyph-canvas-node-text markdown-body"><h1>Card</h1></div>';
    const link = addBox(world, "glyph-canvas-node", [10, 100, 200, 60]);
    link.innerHTML = '<div class="glyph-canvas-node-link" title="https://glyph.dev"></div>';
    const image = addBox(world, "glyph-canvas-node", [10, 200, 200, 60]);
    image.innerHTML = '<img class="glyph-canvas-node-image" src="https://x.dev/p.png" />';
    const file = addBox(world, "glyph-canvas-node", [10, 300, 200, 60]);
    file.innerHTML = '<div class="glyph-canvas-node-file" title="notes/plan.md"></div>';

    const html = (await buildCanvasDocumentHtml()) ?? "";
    expect(html).toContain("<h2>Ideas &amp; plans</h2>");
    expect(html).toContain("<section><h1>Card</h1></section>");
    expect(html).toContain('<a href="https://glyph.dev">https://glyph.dev</a>');
    expect(html).toContain('src="https://x.dev/p.png"');
    expect(html).toContain("notes/plan.md");
    // Cards are separated, and order follows the board DOM.
    expect(html).toContain("<hr");
    expect(html.indexOf("Ideas")).toBeLessThan(html.indexOf("Card"));
  });

  it("skips unlabelled groups and returns null when nothing contributes", async () => {
    const world = mountWorld();
    addBox(world, "glyph-canvas-group", [0, 0, 400, 300]);
    expect(await buildCanvasDocumentHtml()).toBeNull();
  });
});
