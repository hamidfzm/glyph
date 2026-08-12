import { describe, expect, it } from "vitest";
import { lineForOffset, offsetForLine, type ScrollAnchor } from "./splitScrollAnchors";

// Line 1 at the top, a gap between lines 10 and 40 standing in for a block that
// carries no marker (a Mermaid diagram), then a final anchor.
const ANCHORS: ScrollAnchor[] = [
  { line: 1, top: 0 },
  { line: 10, top: 200 },
  { line: 40, top: 600 },
];

describe("offsetForLine", () => {
  it("returns null without anchors", () => {
    expect(offsetForLine([], 5)).toBeNull();
  });

  it("returns an anchor's own offset", () => {
    expect(offsetForLine(ANCHORS, 10)).toBe(200);
  });

  it("interpolates between two anchors", () => {
    expect(offsetForLine(ANCHORS, 5.5)).toBe(100);
  });

  it("interpolates across a gap left by an unmarked block", () => {
    expect(offsetForLine(ANCHORS, 25)).toBe(400);
  });

  it("clamps above and below the outermost anchors", () => {
    expect(offsetForLine(ANCHORS, -3)).toBe(0);
    expect(offsetForLine(ANCHORS, 900)).toBe(600);
  });

  it("handles a single anchor", () => {
    expect(offsetForLine([{ line: 7, top: 120 }], 50)).toBe(120);
  });

  it("does not divide by zero when two anchors share a line", () => {
    const duplicated: ScrollAnchor[] = [
      { line: 4, top: 40 },
      { line: 4, top: 90 },
      { line: 9, top: 300 },
    ];
    expect(Number.isFinite(offsetForLine(duplicated, 4) as number)).toBe(true);
  });
});

describe("lineForOffset", () => {
  it("returns null without anchors", () => {
    expect(lineForOffset([], 40)).toBeNull();
  });

  it("returns an anchor's own line", () => {
    expect(lineForOffset(ANCHORS, 200)).toBe(10);
  });

  it("interpolates between two anchors", () => {
    expect(lineForOffset(ANCHORS, 100)).toBe(5.5);
  });

  it("clamps above and below the outermost anchors", () => {
    expect(lineForOffset(ANCHORS, -50)).toBe(1);
    expect(lineForOffset(ANCHORS, 5000)).toBe(40);
  });

  it("does not divide by zero when two anchors share an offset", () => {
    const duplicated: ScrollAnchor[] = [
      { line: 2, top: 50 },
      { line: 6, top: 50 },
      { line: 9, top: 300 },
    ];
    expect(Number.isFinite(lineForOffset(duplicated, 50) as number)).toBe(true);
  });

  it("round-trips a line through an offset and back", () => {
    const offset = offsetForLine(ANCHORS, 22) as number;
    expect(lineForOffset(ANCHORS, offset)).toBeCloseTo(22);
  });
});
