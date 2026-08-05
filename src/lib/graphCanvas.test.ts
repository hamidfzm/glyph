import { describe, expect, it } from "vitest";
import {
  type Camera,
  DEFAULT_CAMERA,
  fitCameraToNodes,
  hitTestNode,
  MAX_SCALE,
  MIN_SCALE,
  nodeRadius,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
} from "./graphCanvas";
import type { LayoutNode } from "./graphSimulation";

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

describe("fitCameraToNodes", () => {
  const mk = (x: number, y: number, degree = 1): LayoutNode => ({
    id: `${x},${y}`,
    label: "n",
    degree,
    orphan: false,
    x,
    y,
  });

  it("centres the graph's bounding box on the viewport", () => {
    const nodes = [mk(-100, -50), mk(100, 50)];
    const cam = fitCameraToNodes(nodes, VIEWPORT);
    // The world centre (0, 0) lands on the viewport centre.
    const centre = worldToScreen(cam, VIEWPORT, 0, 0);
    expect(centre.x).toBeCloseTo(VIEWPORT.width / 2);
    expect(centre.y).toBeCloseTo(VIEWPORT.height / 2);
  });

  it("keeps every node inside the viewport with padding", () => {
    const nodes = [mk(-500, -300), mk(500, 300), mk(0, 0)];
    const cam = fitCameraToNodes(nodes, VIEWPORT, 48);
    for (const n of nodes) {
      const s = worldToScreen(cam, VIEWPORT, n.x ?? 0, n.y ?? 0);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(VIEWPORT.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it("does not zoom a tiny graph past the fit-max scale", () => {
    const cam = fitCameraToNodes([mk(0, 0), mk(2, 0)], VIEWPORT);
    expect(cam.scale).toBeLessThanOrEqual(1.6);
  });

  it("scales a large graph down to fit", () => {
    const cam = fitCameraToNodes([mk(-2000, -2000), mk(2000, 2000)], VIEWPORT);
    expect(cam.scale).toBeLessThan(1);
    expect(cam.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it("returns the default camera for an empty graph or zero viewport", () => {
    expect(fitCameraToNodes([], VIEWPORT)).toEqual(DEFAULT_CAMERA);
    expect(fitCameraToNodes([mk(0, 0)], { width: 0, height: 0 })).toEqual(DEFAULT_CAMERA);
  });

  it("handles a single node without producing NaNs", () => {
    const cam = fitCameraToNodes([mk(25, -10)], VIEWPORT);
    expect(Number.isFinite(cam.scale)).toBe(true);
    expect(Number.isFinite(cam.dx)).toBe(true);
    expect(Number.isFinite(cam.dy)).toBe(true);
  });

  it("falls back to the origin for nodes without coordinates", () => {
    const node: LayoutNode = { id: "a", label: "a", degree: 0, orphan: true };
    expect(() => fitCameraToNodes([node], VIEWPORT)).not.toThrow();
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

  it("treats a node without coordinates as the origin", () => {
    const n: LayoutNode = { id: "a", label: "a", degree: 0, orphan: true };
    // Origin maps to the viewport centre (400, 300) under the default camera.
    expect(hitTestNode([n], DEFAULT_CAMERA, VIEWPORT, 400, 300)?.id).toBe("a");
  });
});
