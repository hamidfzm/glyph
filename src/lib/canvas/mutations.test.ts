import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  moveNodes,
  removeEdge,
  removeNodes,
  resizeNode,
  setNodesColor,
  updateEdgeLabel,
  updateGroupLabel,
  updateTextNode,
} from "./mutations";
import type { CanvasData, TextNode } from "./types";

const text = (id: string, over: Partial<TextNode> = {}): TextNode => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  text: "",
  ...over,
});

const base: CanvasData = {
  nodes: [text("a"), text("b", { x: 200 })],
  edges: [{ id: "e", fromNode: "a", toNode: "b" }],
};

describe("moveNodes", () => {
  it("shifts only the selected nodes and is immutable", () => {
    const next = moveNodes(base, new Set(["a"]), 10, 5);
    expect(next.nodes[0]).toMatchObject({ x: 10, y: 5 });
    expect(next.nodes[1]).toMatchObject({ x: 200, y: 0 });
    expect(base.nodes[0].x).toBe(0); // original untouched
  });
  it("returns the same reference for a no-op", () => {
    expect(moveNodes(base, new Set(), 5, 5)).toBe(base);
    expect(moveNodes(base, new Set(["a"]), 0, 0)).toBe(base);
  });
});

describe("resizeNode", () => {
  it("replaces geometry", () => {
    const next = resizeNode(base, "a", { x: 5, y: 6, width: 300, height: 200 });
    expect(next.nodes[0]).toMatchObject({ x: 5, y: 6, width: 300, height: 200 });
  });
});

describe("setNodesColor", () => {
  it("sets and clears colour", () => {
    const colored = setNodesColor(base, new Set(["a"]), "3");
    expect(colored.nodes[0].color).toBe("3");
    const cleared = setNodesColor(colored, new Set(["a"]), undefined);
    expect(cleared.nodes[0]).not.toHaveProperty("color");
  });
});

describe("updateTextNode / updateGroupLabel", () => {
  it("updates text node body", () => {
    expect(updateTextNode(base, "a", "hi").nodes[0]).toMatchObject({ text: "hi" });
  });
  it("ignores group label on a text node", () => {
    expect(updateGroupLabel(base, "a", "x").nodes[0]).not.toHaveProperty("label");
  });
});

describe("add/remove nodes", () => {
  it("adds a node", () => {
    expect(addNode(base, text("c")).nodes).toHaveLength(3);
  });
  it("removes nodes and their connected edges", () => {
    const next = removeNodes(base, new Set(["a"]));
    expect(next.nodes.map((n) => n.id)).toEqual(["b"]);
    expect(next.edges).toHaveLength(0);
  });
  it("returns the same reference when the id set is empty", () => {
    expect(removeNodes(base, new Set())).toBe(base);
  });
  it("drops an edge when only its toNode is removed", () => {
    // fromNode "a" survives, toNode "b" is removed: exercises the second
    // operand of the edge-retention predicate.
    const next = removeNodes(base, new Set(["b"]));
    expect(next.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(next.edges).toHaveLength(0);
  });
});

describe("edges", () => {
  it("adds and removes an edge", () => {
    const added = addEdge(base, { id: "e2", fromNode: "b", toNode: "a" });
    expect(added.edges).toHaveLength(2);
    expect(removeEdge(added, "e2").edges.map((e) => e.id)).toEqual(["e"]);
  });
  it("sets and clears an edge label", () => {
    expect(updateEdgeLabel(base, "e", "rel").edges[0].label).toBe("rel");
    expect(updateEdgeLabel(base, "e", "").edges[0]).not.toHaveProperty("label");
  });
  it("leaves non-matching edges untouched when relabelling", () => {
    const two = addEdge(base, { id: "e2", fromNode: "b", toNode: "a", label: "keep" });
    const next = updateEdgeLabel(two, "e", "rel");
    expect(next.edges[0].label).toBe("rel");
    expect(next.edges[1]).toBe(two.edges[1]);
  });
});
