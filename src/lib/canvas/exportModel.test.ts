import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanvasBoardModel } from "./exportModel";

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

describe("buildCanvasBoardModel", () => {
  it("returns null when no board is mounted", async () => {
    expect(await buildCanvasBoardModel()).toBeNull();
  });

  it("shifts card geometry into the export frame (origin includes the margin)", async () => {
    const world = mountWorld();
    addBox(world, "glyph-canvas-node", [100, 50, 200, 80]);

    const model = await buildCanvasBoardModel();
    // Single node: origin is (100-48, 50-48); the card lands at the margin.
    expect(model?.width).toBe(200 + 96);
    expect(model?.height).toBe(80 + 96);
    expect(model?.cards[0]).toMatchObject({ kind: "card", x: 48, y: 48, width: 200, height: 80 });
  });

  it("classifies groups, extracts labels, and keeps backgrounds light", async () => {
    const world = mountWorld();
    const group = addBox(world, "glyph-canvas-group", [0, 0, 400, 300]);
    group.innerHTML = '<div class="glyph-canvas-node-group-label">Plans</div>';
    addBox(world, "glyph-canvas-node", [10, 10, 100, 50]);

    const model = await buildCanvasBoardModel();
    const g = model?.cards[0];
    expect(g).toMatchObject({ kind: "group", label: "Plans" });
    expect(g?.borderColor).toBeTruthy();
    // Paper palette regardless of the app theme: PDF text is dark on light.
    expect(g?.background).toBe("#f2f2f4");
    expect(model?.cards[1].background).toBe("#ffffff");
  });

  it("captures card markdown with checkboxes replaced by ascii markers", async () => {
    const world = mountWorld();
    const card = addBox(world, "glyph-canvas-node", [0, 0, 200, 80]);
    card.innerHTML =
      '<div class="glyph-canvas-node-text markdown-body"><ul>' +
      '<li><input type="checkbox" /> ship</li>' +
      '<li><input type="checkbox" /> wait</li></ul></div>';
    const boxes = card.querySelectorAll("input");
    boxes[0].checked = true; // property only, like a live React checkbox

    const model = await buildCanvasBoardModel();
    expect(model?.cards[0].html).toContain("[x] ship");
    expect(model?.cards[0].html).toContain("[ ] wait");
    expect(model?.cards[0].html).not.toContain("<input");
  });

  it("captures link URLs and file display names", async () => {
    const world = mountWorld();
    const link = addBox(world, "glyph-canvas-node", [0, 0, 200, 60]);
    link.innerHTML = '<div class="glyph-canvas-node-link" title="https://glyph.dev"></div>';
    const file = addBox(world, "glyph-canvas-node", [0, 100, 200, 60]);
    file.innerHTML = '<div class="glyph-canvas-node-file" title="notes/plan.md"></div>';

    const model = await buildCanvasBoardModel();
    expect(model?.cards[0].linkUrl).toBe("https://glyph.dev");
    expect(model?.cards[1].fileName).toBe("plan.md");
  });

  it("bakes the edges svg with concrete attributes and a shifted viewBox", async () => {
    const world = mountWorld();
    addBox(world, "glyph-canvas-node", [100, 50, 200, 80]);
    world.insertAdjacentHTML(
      "beforeend",
      '<svg class="glyph-canvas-edges">' +
        '<path class="glyph-canvas-edge-hit" d="M0 0"/>' +
        '<path d="M10 20 C 1 2, 3 4, 50 60" style="stroke: rgb(48, 209, 88); stroke-width: 3px"/>' +
        '<polygon points="1,2 3,4 5,6" style="fill: rgb(48, 209, 88)"/>' +
        '<text x="30" y="40" style="fill: rgb(99, 99, 102); font-size: 14px">spec &amp; co</text>' +
        "<text>bare</text>" +
        "</svg>",
    );

    const model = await buildCanvasBoardModel();
    const svg = model?.edgesSvg ?? "";
    expect(svg).toContain('viewBox="52 2 296 176"');
    expect(svg).toContain('d="M10 20 C 1 2, 3 4, 50 60"');
    expect(svg).toContain('points="1,2 3,4 5,6"');
    expect(svg).toContain("spec &amp; co");
    // Inline styles resolve through getComputedStyle and land as attributes.
    expect(svg).toContain('stroke="rgb(48, 209, 88)" stroke-width="3"');
    expect(svg).toContain('<polygon points="1,2 3,4 5,6" fill="rgb(48, 209, 88)"');
    expect(svg).toContain('font-size="14"');
    // A text element without coordinates falls back to the origin.
    expect(svg).toContain('<text x="0" y="0"');
    // The widened hit path is editor chrome, not a visible edge.
    expect(svg).not.toContain('d="M0 0"');
    // Every element carries baked attributes, never classes.
    expect(svg).not.toContain("class=");
    expect(svg).toMatch(/stroke="[^"]+"/);
  });

  it("produces an empty svg shell when the board has no edges", async () => {
    const world = mountWorld();
    addBox(world, "glyph-canvas-node", [0, 0, 100, 50]);
    const model = await buildCanvasBoardModel();
    expect(model?.edgesSvg).toMatch(/^<svg[^>]*><\/svg>$/);
  });
});
