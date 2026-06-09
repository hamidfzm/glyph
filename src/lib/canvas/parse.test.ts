import { describe, expect, it } from "vitest";
import { parseCanvas } from "./parse";
import { CanvasParseError } from "./types";

describe("parseCanvas", () => {
  it("parses a minimal text node", () => {
    const json = JSON.stringify({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 60, text: "# Hi" }],
      edges: [],
    });
    const data = parseCanvas(json);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]).toMatchObject({ id: "a", type: "text", text: "# Hi" });
  });

  it("parses all node types and keeps optional fields", () => {
    const json = JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x", color: "1" },
        { id: "f", type: "file", x: 0, y: 0, width: 10, height: 10, file: "a.md", subpath: "#h" },
        { id: "l", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://x.dev" },
        { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10, label: "Box" },
      ],
    });
    const { nodes } = parseCanvas(json);
    expect(nodes.map((n) => n.type)).toEqual(["text", "file", "link", "group"]);
    expect(nodes[1]).toMatchObject({ file: "a.md", subpath: "#h" });
    expect(nodes[3]).toMatchObject({ label: "Box" });
  });

  it("drops nodes missing required or geometry fields", () => {
    const json = JSON.stringify({
      nodes: [
        { id: "ok", type: "text", x: 0, y: 0, width: 10, height: 10, text: "y" },
        { id: "no-text", type: "text", x: 0, y: 0, width: 10, height: 10 },
        { id: "no-geo", type: "text", x: 0, text: "z" },
        { type: "text", x: 0, y: 0, width: 10, height: 10, text: "no-id" },
        { id: "weird", type: "sticker", x: 0, y: 0, width: 10, height: 10 },
      ],
    });
    const { nodes } = parseCanvas(json);
    expect(nodes.map((n) => n.id)).toEqual(["ok"]);
  });

  it("parses edges and defaults sides/ends", () => {
    const json = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" },
        { id: "b", type: "text", x: 0, y: 0, width: 10, height: 10, text: "b" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", toSide: "left", label: "rel" }],
    });
    const { edges } = parseCanvas(json);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromNode: "a", toNode: "b", toSide: "left", label: "rel" });
  });

  it("drops edges that reference unknown nodes", () => {
    const json = JSON.stringify({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" }],
      edges: [{ id: "e", fromNode: "a", toNode: "ghost" }],
    });
    expect(parseCanvas(json).edges).toHaveLength(0);
  });

  it("treats an empty string as a blank canvas", () => {
    expect(parseCanvas("   ")).toEqual({ nodes: [], edges: [] });
  });

  it("treats `{}` as a valid empty canvas", () => {
    expect(parseCanvas("{}")).toEqual({ nodes: [], edges: [] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseCanvas("{not json")).toThrow(CanvasParseError);
  });

  it("throws on a non-object root", () => {
    expect(() => parseCanvas("[1,2,3]")).toThrow(CanvasParseError);
  });

  describe("optional-field branches", () => {
    it("keeps a node color when set and omits it when absent", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "c", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x", color: "2" },
          { id: "n", type: "text", x: 0, y: 0, width: 10, height: 10, text: "y" },
        ],
      });
      const { nodes } = parseCanvas(json);
      expect(nodes[0]).toMatchObject({ id: "c", color: "2" });
      expect(nodes[1].color).toBeUndefined();
    });

    it("handles a file node without a subpath", () => {
      const json = JSON.stringify({
        nodes: [{ id: "f", type: "file", x: 0, y: 0, width: 10, height: 10, file: "a.md" }],
      });
      const { nodes } = parseCanvas(json);
      expect(nodes[0]).toMatchObject({ type: "file", file: "a.md" });
      expect(nodes[0]).not.toHaveProperty("subpath");
    });

    it("keeps group label/background/backgroundStyle when present and valid", () => {
      const json = JSON.stringify({
        nodes: [
          {
            id: "g",
            type: "group",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            label: "Box",
            background: "img.png",
            backgroundStyle: "cover",
          },
        ],
      });
      const { nodes } = parseCanvas(json);
      expect(nodes[0]).toMatchObject({
        type: "group",
        label: "Box",
        background: "img.png",
        backgroundStyle: "cover",
      });
    });

    it("omits group optionals when absent and drops an invalid backgroundStyle", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "bare", type: "group", x: 0, y: 0, width: 10, height: 10 },
          {
            id: "bad",
            type: "group",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            backgroundStyle: "stretch",
          },
        ],
      });
      const { nodes } = parseCanvas(json);
      expect(nodes[0]).not.toHaveProperty("label");
      expect(nodes[0]).not.toHaveProperty("background");
      expect(nodes[0]).not.toHaveProperty("backgroundStyle");
      expect(nodes[1]).not.toHaveProperty("backgroundStyle");
    });

    it("keeps every optional edge field when present", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" },
          { id: "b", type: "text", x: 0, y: 0, width: 10, height: 10, text: "b" },
        ],
        edges: [
          {
            id: "e",
            fromNode: "a",
            toNode: "b",
            fromSide: "right",
            toSide: "left",
            fromEnd: "arrow",
            toEnd: "none",
            color: "3",
            label: "rel",
          },
        ],
      });
      const { edges } = parseCanvas(json);
      expect(edges[0]).toMatchObject({
        fromSide: "right",
        toSide: "left",
        fromEnd: "arrow",
        toEnd: "none",
        color: "3",
        label: "rel",
      });
    });

    it("omits every optional edge field when absent", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" },
          { id: "b", type: "text", x: 0, y: 0, width: 10, height: 10, text: "b" },
        ],
        edges: [{ id: "e", fromNode: "a", toNode: "b" }],
      });
      const { edges } = parseCanvas(json);
      expect(edges[0]).toEqual({ id: "e", fromNode: "a", toNode: "b" });
    });

    it("treats non-array nodes/edges as empty", () => {
      const json = JSON.stringify({ nodes: "x", edges: 42 });
      expect(parseCanvas(json)).toEqual({ nodes: [], edges: [] });
    });

    it("drops a node that is not an object", () => {
      const json = JSON.stringify({
        nodes: [null, 7, { id: "ok", type: "text", x: 0, y: 0, width: 10, height: 10, text: "y" }],
      });
      const { nodes } = parseCanvas(json);
      expect(nodes.map((n) => n.id)).toEqual(["ok"]);
    });

    it("drops an edge that is not an object", () => {
      const json = JSON.stringify({
        nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" }],
        edges: [null, 5],
      });
      expect(parseCanvas(json).edges).toEqual([]);
    });

    it("drops file and link nodes missing their type-specific field", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "no-file", type: "file", x: 0, y: 0, width: 10, height: 10 },
          { id: "no-url", type: "link", x: 0, y: 0, width: 10, height: 10 },
          { id: "ok", type: "text", x: 0, y: 0, width: 10, height: 10, text: "y" },
        ],
      });
      expect(parseCanvas(json).nodes.map((n) => n.id)).toEqual(["ok"]);
    });

    it("drops edges missing id/fromNode/toNode", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" },
          { id: "b", type: "text", x: 0, y: 0, width: 10, height: 10, text: "b" },
        ],
        edges: [
          { fromNode: "a", toNode: "b" },
          { id: "e", toNode: "b" },
          { id: "e", fromNode: "a" },
        ],
      });
      expect(parseCanvas(json).edges).toEqual([]);
    });
  });
});
