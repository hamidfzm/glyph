import { describe, expect, it } from "vitest";
import { clampScale, fitScale, fitWidthScale, MAX_SCALE, MIN_SCALE } from "./lightbox";

describe("clampScale", () => {
  it("keeps values within [MIN_SCALE, MAX_SCALE]", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1000)).toBe(MAX_SCALE);
  });
});

describe("fitScale", () => {
  it("returns 1 when a dimension is unknown", () => {
    expect(fitScale(0, 100, 100, 100)).toBe(1);
    expect(fitScale(100, 100, 0, 100)).toBe(1);
  });

  it("scales down a large image to contain it", () => {
    // 2000x1000 into 1000x1000 → limited by width → 0.5
    expect(fitScale(2000, 1000, 1000, 1000)).toBe(0.5);
  });

  it("scales up a small image to fill the box", () => {
    // 100x100 into 500x500 → 5, but capped at MAX_SCALE only if exceeded
    expect(fitScale(100, 100, 500, 500)).toBe(5);
  });

  it("uses the limiting axis", () => {
    // 1000x2000 into 1000x1000 → limited by height → 0.5
    expect(fitScale(1000, 2000, 1000, 1000)).toBe(0.5);
  });
});

describe("fitWidthScale", () => {
  it("returns 1 when a width is unknown", () => {
    expect(fitWidthScale(0, 1000)).toBe(1);
    expect(fitWidthScale(1000, 0)).toBe(1);
  });

  it("shrinks a wide table to the available width", () => {
    expect(fitWidthScale(2000, 1000)).toBe(0.5);
  });

  it("never enlarges a narrow table past actual size", () => {
    expect(fitWidthScale(400, 1000)).toBe(1);
  });

  it("stays within the minimum scale for an extreme table", () => {
    expect(fitWidthScale(1_000_000, 100)).toBe(MIN_SCALE);
  });
});
