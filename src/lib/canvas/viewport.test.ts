import { describe, expect, it } from "vitest";
import {
  clampZoom,
  fitToContent,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "./viewport";

describe("clampZoom", () => {
  it("clamps to the allowed range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });
});

describe("screen/world conversions", () => {
  const vp = { x: 100, y: 50, zoom: 2 };
  it("round-trips a point", () => {
    const world = screenToWorld(vp, { x: 300, y: 250 });
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(vp, world)).toEqual({ x: 300, y: 250 });
  });
});

describe("zoomAt", () => {
  it("keeps the pivot's world point fixed", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const pivot = { x: 200, y: 120 };
    const before = screenToWorld(vp, pivot);
    const after = zoomAt(vp, 1.5, pivot);
    const worldAfter = screenToWorld(after, pivot);
    expect(worldAfter.x).toBeCloseTo(before.x, 6);
    expect(worldAfter.y).toBeCloseTo(before.y, 6);
    expect(after.zoom).toBe(1.5);
  });

  it("respects zoom clamps", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: MAX_ZOOM }, 2, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
});

describe("pan", () => {
  it("offsets by the screen delta", () => {
    expect(pan({ x: 10, y: 20, zoom: 1 }, 5, -5)).toEqual({ x: 15, y: 15, zoom: 1 });
  });
});

describe("fitToContent", () => {
  it("returns a neutral viewport for empty content", () => {
    expect(fitToContent(null, 800, 600)).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("centres content and never zooms past 1", () => {
    const vp = fitToContent({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 800, 600, 40);
    expect(vp.zoom).toBe(1);
    // 100-wide content centred in 800 → left offset 350.
    expect(vp.x).toBeCloseTo(350, 6);
    expect(vp.y).toBeCloseTo(250, 6);
  });

  it("scales down to fit large content", () => {
    const vp = fitToContent({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, 800, 600, 40);
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});
