import { describe, expect, it, vi } from "vitest";
import type { WikilinkRef } from "./backlinks";
import { buildWorkspaceGraph } from "./graph";
import {
  type Camera,
  DEFAULT_CAMERA,
  drawGraph,
  hitTestNode,
  MAX_SCALE,
  MIN_SCALE,
  nodeRadius,
  panCamera,
  readGraphTheme,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
} from "./graphCanvas";
import { createGraphLayout, type GraphLayout, type LayoutNode } from "./graphSimulation";

const VIEWPORT = { width: 800, height: 600 };

function node(id: string, x: number, y: number, degree = 0): LayoutNode {
  return { id, label: id, degree, orphan: degree === 0, x, y };
}

describe("camera math", () => {
  it("pans by screen deltas", () => {
    expect(panCamera(DEFAULT_CAMERA, 10, -5)).toEqual({ dx: 10, dy: -5, scale: 1 });
  });

  it("round-trips world <-> screen", () => {
    const camera: Camera = { dx: 33, dy: -12, scale: 2.5 };
    const screen = worldToScreen(camera, VIEWPORT, 40, -25);
    const world = screenToWorld(camera, VIEWPORT, screen.x, screen.y);
    expect(world.x).toBeCloseTo(40);
    expect(world.y).toBeCloseTo(-25);
  });

  it("maps world origin to the viewport center by default", () => {
    expect(worldToScreen(DEFAULT_CAMERA, VIEWPORT, 0, 0)).toEqual({ x: 400, y: 300 });
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const camera: Camera = { dx: 20, dy: 10, scale: 1 };
    const cursor = { x: 500, y: 200 };
    const before = screenToWorld(camera, VIEWPORT, cursor.x, cursor.y);
    const zoomed = zoomCameraAt(camera, cursor.x, cursor.y, 1.7, VIEWPORT);
    const after = screenToWorld(zoomed, VIEWPORT, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomed.scale).toBeCloseTo(1.7);
  });

  it("clamps zoom to the scale bounds", () => {
    expect(zoomCameraAt(DEFAULT_CAMERA, 0, 0, 1e9, VIEWPORT).scale).toBe(MAX_SCALE);
    expect(zoomCameraAt(DEFAULT_CAMERA, 0, 0, 1e-9, VIEWPORT).scale).toBe(MIN_SCALE);
  });

  it("returns the same camera when already at the clamp", () => {
    const atMax: Camera = { dx: 0, dy: 0, scale: MAX_SCALE };
    expect(zoomCameraAt(atMax, 100, 100, 2, VIEWPORT)).toBe(atMax);
  });
});

describe("nodeRadius", () => {
  it("grows with degree and is capped", () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(10_000)).toBe(14);
  });
});

describe("hitTestNode", () => {
  const nodes = [node("a", 0, 0), node("b", 100, 0)];

  it("finds the node under the cursor", () => {
    // World (100, 0) is screen (500, 300) with the default camera.
    expect(hitTestNode(nodes, DEFAULT_CAMERA, VIEWPORT, 500, 300)?.id).toBe("b");
  });

  it("returns null on empty space", () => {
    expect(hitTestNode(nodes, DEFAULT_CAMERA, VIEWPORT, 450, 300)).toBeNull();
  });

  it("applies slop in screen pixels", () => {
    // 5px outside the 4px radius: misses with slop 0, hits with slop 8.
    expect(hitTestNode(nodes, DEFAULT_CAMERA, VIEWPORT, 409, 300, 0)).toBeNull();
    expect(hitTestNode(nodes, DEFAULT_CAMERA, VIEWPORT, 409, 300, 8)?.id).toBe("a");
  });

  it("prefers the topmost (last drawn) node when overlapping", () => {
    const overlapping = [node("under", 0, 0), node("over", 1, 0)];
    expect(hitTestNode(overlapping, DEFAULT_CAMERA, VIEWPORT, 400, 300)?.id).toBe("over");
  });

  it("respects the camera transform", () => {
    const camera: Camera = { dx: -50, dy: 25, scale: 2 };
    const screen = worldToScreen(camera, VIEWPORT, 100, 0);
    expect(hitTestNode(nodes, camera, VIEWPORT, screen.x, screen.y)?.id).toBe("b");
  });
});

describe("readGraphTheme", () => {
  it("falls back to defaults when variables are missing", () => {
    const theme = readGraphTheme(document.documentElement);
    expect(theme.node).toBeTruthy();
    expect(theme.edge).toBeTruthy();
    expect(theme.label).toBeTruthy();
  });

  it("reads CSS custom properties when present", () => {
    document.documentElement.style.setProperty("--color-accent", "#ff0000");
    try {
      const theme = readGraphTheme(document.documentElement);
      expect(theme.nodeActive).toBe("#ff0000");
      expect(theme.edgeActive).toBe("#ff0000");
    } finally {
      document.documentElement.style.removeProperty("--color-accent");
    }
  });
});

// A recording stand-in for CanvasRenderingContext2D: drawGraph only needs the
// calls below, and asserting against the recorder keeps these tests
// independent of a real rasterizer.
function stubContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
}

const THEME = {
  node: "node",
  nodeOrphan: "orphan",
  nodeActive: "active",
  edge: "edge",
  edgeActive: "edge-active",
  label: "label",
};

function makeLayout(): GraphLayout {
  const refs: WikilinkRef[] = [{ source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" }];
  return createGraphLayout(buildWorkspaceGraph(["/v/a.md", "/v/b.md", "/v/lone.md"], refs));
}

function drawOptions(hoveredId: string | null = null) {
  const graph = buildWorkspaceGraph(
    ["/v/a.md", "/v/b.md", "/v/lone.md"],
    [{ source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" }],
  );
  return {
    viewport: VIEWPORT,
    dpr: 2,
    camera: DEFAULT_CAMERA,
    theme: THEME,
    hoveredId,
    neighbors: graph.neighbors,
  };
}

describe("drawGraph", () => {
  it("clears the viewport and applies the DPR + camera transforms", () => {
    const ctx = stubContext();
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions());
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, VIEWPORT.width, VIEWPORT.height);
    expect(ctx.setTransform).toHaveBeenNthCalledWith(1, 2, 0, 0, 2, 0, 0);
    expect(ctx.setTransform).toHaveBeenNthCalledWith(2, 2, 0, 0, 2, 2 * 400, 2 * 300);
  });

  it("draws one circle per node and one line per edge", () => {
    const ctx = stubContext();
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions());
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("labels every node when zoomed in", () => {
    const ctx = stubContext();
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions());
    const labels = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(["a", "b", "lone"]);
  });

  it("hides labels when zoomed far out, except the hovered neighborhood", () => {
    const ctx = stubContext();
    const zoomedOut = { ...drawOptions("/v/a.md"), camera: { dx: 0, dy: 0, scale: 0.3 } };
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), zoomedOut);
    const labels = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(["a", "b"]);
  });

  it("draws an arrow tip only for edges touching the hovered node", () => {
    const plain = stubContext();
    drawGraph(plain as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions());
    const hovered = stubContext();
    drawGraph(hovered as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions("/v/a.md"));
    // The arrow tip adds a closePath + fill pair beyond the node circles.
    expect(plain.closePath).not.toHaveBeenCalled();
    expect(hovered.closePath).toHaveBeenCalledTimes(1);
  });

  it("styles orphan nodes with the muted color", () => {
    const ctx = stubContext();
    const fills: string[] = [];
    Object.defineProperty(ctx, "fillStyle", {
      set: (v: string) => fills.push(v),
      get: () => "",
    });
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions());
    expect(fills).toContain("orphan");
    expect(fills).toContain("node");
  });

  it("uses the active color for the hovered neighborhood", () => {
    const ctx = stubContext();
    const fills: string[] = [];
    Object.defineProperty(ctx, "fillStyle", {
      set: (v: string) => fills.push(v),
      get: () => "",
    });
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions("/v/a.md"));
    // a and its neighbor b are active; lone is not.
    expect(fills.filter((f) => f === "active").length).toBeGreaterThanOrEqual(2);
    expect(fills).toContain("orphan");
  });

  it("resets globalAlpha when done", () => {
    const ctx = stubContext();
    drawGraph(ctx as unknown as CanvasRenderingContext2D, makeLayout(), drawOptions("/v/a.md"));
    expect(ctx.globalAlpha).toBe(1);
  });
});
