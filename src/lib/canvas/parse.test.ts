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
});
