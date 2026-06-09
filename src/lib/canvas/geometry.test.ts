import { describe, expect, it } from "vitest";
import {
  arrowheadPoints,
  bezierPath,
  inferSide,
  nodeCenter,
  nodesBoundingBox,
  sideAnchor,
} from "./geometry";
import type { CanvasNode, TextNode } from "./types";

const node = (over: Partial<TextNode>): TextNode => ({
  id: "n",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  text: "",
  ...over,
});

describe("nodeCenter", () => {
  it("returns the geometric centre", () => {
    expect(nodeCenter(node({ x: 10, y: 20, width: 100, height: 50 }))).toEqual({ x: 60, y: 45 });
  });
});

describe("sideAnchor", () => {
  const n = node({ x: 0, y: 0, width: 100, height: 50 });
  it("anchors each side at the edge midpoint", () => {
    expect(sideAnchor(n, "top")).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(n, "bottom")).toEqual({ x: 50, y: 50 });
    expect(sideAnchor(n, "left")).toEqual({ x: 0, y: 25 });
    expect(sideAnchor(n, "right")).toEqual({ x: 100, y: 25 });
  });
});

describe("inferSide", () => {
  const from = node({ x: 0, y: 0, width: 100, height: 100 });
  it("picks the horizontal side when the gap is wider than tall", () => {
    expect(inferSide(from, node({ x: 400, y: 10, width: 100, height: 100 }))).toBe("right");
    expect(inferSide(from, node({ x: -400, y: 10, width: 100, height: 100 }))).toBe("left");
  });
  it("picks the vertical side when the gap is taller than wide", () => {
    expect(inferSide(from, node({ x: 10, y: 400, width: 100, height: 100 }))).toBe("bottom");
    expect(inferSide(from, node({ x: 10, y: -400, width: 100, height: 100 }))).toBe("top");
  });
});

describe("bezierPath", () => {
  it("starts and ends at the given points", () => {
    const d = bezierPath({ x: 0, y: 0 }, "right", { x: 200, y: 0 }, "left");
    expect(d.startsWith("M 0 0 C")).toBe(true);
    expect(d.endsWith("200 0")).toBe(true);
  });
});

describe("arrowheadPoints", () => {
  it("places the tip at the anchor and points inward", () => {
    // A right-side tip points left (into the node): base corners sit to the
    // right of the tip.
    const points = arrowheadPoints({ x: 100, y: 50 }, "right", 9)
      .split(" ")
      .map((p) => {
        const [x, y] = p.split(",").map(Number);
        return { x, y };
      });
    expect(points[0]).toEqual({ x: 100, y: 50 });
    expect(points[1].x).toBeGreaterThan(100);
    expect(points[2].x).toBeGreaterThan(100);
  });
});

describe("nodesBoundingBox", () => {
  it("returns null for an empty canvas", () => {
    expect(nodesBoundingBox([])).toBeNull();
  });
  it("covers every node", () => {
    const nodes: CanvasNode[] = [
      node({ id: "a", x: 0, y: 0, width: 100, height: 50 }),
      node({ id: "b", x: 200, y: 300, width: 100, height: 50 }),
    ];
    expect(nodesBoundingBox(nodes)).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 350 });
  });
});
