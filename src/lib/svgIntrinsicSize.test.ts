import { describe, expect, it } from "vitest";
import { svgIntrinsicSize } from "./svgIntrinsicSize";

describe("svgIntrinsicSize", () => {
  it("reads explicit pixel width/height", () => {
    expect(svgIntrinsicSize('<svg width="120" height="80"></svg>')).toEqual({ w: 120, h: 80 });
    expect(svgIntrinsicSize('<svg width="120px" height="80px"/>')).toEqual({ w: 120, h: 80 });
  });

  it("falls back to the viewBox when width/height are absent", () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 200 100"></svg>')).toEqual({ w: 200, h: 100 });
    expect(svgIntrinsicSize('<svg viewBox="0,0,200,100"/>')).toEqual({ w: 200, h: 100 });
  });

  it("does not read width from a hyphenated attribute like stroke-width", () => {
    expect(svgIntrinsicSize('<svg height="80" viewBox="0 0 200 100" stroke-width="2"/>')).toEqual({
      w: 200,
      h: 100,
    });
  });

  it("ignores non-pixel lengths and uses the viewBox instead", () => {
    expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 50 25"/>')).toEqual({
      w: 50,
      h: 25,
    });
  });

  it("returns null for a dimensionless SVG", () => {
    expect(svgIntrinsicSize("<svg></svg>")).toBeNull();
    expect(svgIntrinsicSize('<svg width="100%"/>')).toBeNull();
    expect(svgIntrinsicSize('<svg viewBox="0 0 0 100"/>')).toBeNull();
    expect(svgIntrinsicSize("not svg at all")).toBeNull();
  });
});
