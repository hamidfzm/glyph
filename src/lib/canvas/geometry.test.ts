import { describe, expect, it } from "vitest";
import {
  arrowheadPoints,
  bezierPath,
  inferSide,
  nodeAtPoint,
  nodeCenter,
  nodeContainsPoint,
  nodeIdsInGroup,
  nodesBoundingBox,
  sideAnchor,
} from "./geometry";
import type { CanvasNode, GroupNode, TextNode } from "./types";

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

  const tipAndBase = (side: "left" | "top" | "bottom") => {
    const [tip, p1, p2] = arrowheadPoints({ x: 50, y: 50 }, side, 9)
      .split(" ")
      .map((p) => {
        const [x, y] = p.split(",").map(Number);
        return { x, y };
      });
    return { tip, p1, p2 };
  };

  it("points a left-side tip rightward (base corners left of the tip)", () => {
    const { tip, p1, p2 } = tipAndBase("left");
    expect(tip).toEqual({ x: 50, y: 50 });
    expect(p1.x).toBeLessThan(50);
    expect(p2.x).toBeLessThan(50);
  });

  it("points a top-side tip downward (base corners above the tip)", () => {
    const { tip, p1, p2 } = tipAndBase("top");
    expect(tip).toEqual({ x: 50, y: 50 });
    expect(p1.y).toBeLessThan(50);
    expect(p2.y).toBeLessThan(50);
  });

  it("points a bottom-side tip upward (base corners below the tip)", () => {
    const { tip, p1, p2 } = tipAndBase("bottom");
    expect(tip).toEqual({ x: 50, y: 50 });
    expect(p1.y).toBeGreaterThan(50);
    expect(p2.y).toBeGreaterThan(50);
  });
});

describe("nodeContainsPoint", () => {
  const n = node({ x: 0, y: 0, width: 100, height: 50 });
  it("is true for a point inside the rectangle", () => {
    expect(nodeContainsPoint(n, { x: 50, y: 25 })).toBe(true);
  });
  it("is false for a point outside the rectangle", () => {
    expect(nodeContainsPoint(n, { x: 150, y: 25 })).toBe(false);
  });
});

describe("nodeAtPoint", () => {
  const group = (over: Partial<GroupNode>): GroupNode => ({
    id: "g",
    type: "group",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...over,
  });

  it("returns the topmost (last-painted) node under the point", () => {
    const nodes: CanvasNode[] = [
      node({ id: "under", x: 0, y: 0, width: 100, height: 50 }),
      node({ id: "over", x: 0, y: 0, width: 100, height: 50 }),
    ];
    expect(nodeAtPoint(nodes, { x: 10, y: 10 })?.id).toBe("over");
  });

  it("skips group nodes", () => {
    const nodes: CanvasNode[] = [group({ id: "g", x: 0, y: 0, width: 100, height: 50 })];
    expect(nodeAtPoint(nodes, { x: 10, y: 10 })).toBeNull();
  });

  it("skips excluded ids", () => {
    const nodes: CanvasNode[] = [node({ id: "a", x: 0, y: 0, width: 100, height: 50 })];
    expect(nodeAtPoint(nodes, { x: 10, y: 10 }, new Set(["a"]))).toBeNull();
  });

  it("returns null when no node is hit", () => {
    const nodes: CanvasNode[] = [node({ id: "a", x: 0, y: 0, width: 100, height: 50 })];
    expect(nodeAtPoint(nodes, { x: 500, y: 500 })).toBeNull();
  });
});

describe("nodeIdsInGroup", () => {
  const group: GroupNode = { id: "g", type: "group", x: 0, y: 0, width: 400, height: 300 };
  it("contains nodes fully inside the bounds and excludes the group itself", () => {
    const nodes: CanvasNode[] = [
      group,
      node({ id: "inside", x: 50, y: 50 }),
      node({ id: "partial", x: 350, y: 50 }), // sticks out on the right
      node({ id: "outside", x: 600, y: 0 }),
    ];
    expect([...nodeIdsInGroup(nodes, group)]).toEqual(["inside"]);
  });

  it("includes a nested group that fits entirely inside", () => {
    const inner: GroupNode = { id: "g2", type: "group", x: 10, y: 10, width: 100, height: 100 };
    expect(nodeIdsInGroup([group, inner], group).has("g2")).toBe(true);
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
