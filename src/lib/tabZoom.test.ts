import { describe, expect, it } from "vitest";
import {
  clampTabZoom,
  TAB_ZOOM_MAX,
  TAB_ZOOM_MIN,
  tabZoomByWheel,
  tabZoomIn,
  tabZoomOut,
} from "./tabZoom";

describe("tabZoom", () => {
  it("clamps to the allowed range", () => {
    expect(clampTabZoom(10)).toBe(TAB_ZOOM_MAX);
    expect(clampTabZoom(0.01)).toBe(TAB_ZOOM_MIN);
    expect(clampTabZoom(1.5)).toBe(1.5);
  });

  it("steps in and out multiplicatively", () => {
    expect(tabZoomIn(1)).toBeCloseTo(1.1);
    expect(tabZoomOut(1)).toBeCloseTo(1 / 1.1);
    expect(tabZoomOut(tabZoomIn(2))).toBeCloseTo(2);
  });

  it("never steps past the bounds", () => {
    expect(tabZoomIn(TAB_ZOOM_MAX)).toBe(TAB_ZOOM_MAX);
    expect(tabZoomOut(TAB_ZOOM_MIN)).toBe(TAB_ZOOM_MIN);
  });

  it("zooms in on scroll up (negative deltaY) and out on scroll down", () => {
    expect(tabZoomByWheel(1, -100)).toBeGreaterThan(1);
    expect(tabZoomByWheel(1, 100)).toBeLessThan(1);
  });
});
