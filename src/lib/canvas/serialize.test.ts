import { describe, expect, it } from "vitest";
import { parseCanvas } from "./parse";
import { serializeCanvas } from "./serialize";
import type { CanvasData } from "./types";

describe("serializeCanvas", () => {
  it("omits undefined optional fields", () => {
    const data: CanvasData = {
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "hi" }],
      edges: [],
    };
    const json = JSON.parse(serializeCanvas(data));
    expect(json.nodes[0]).not.toHaveProperty("color");
    expect(json.nodes[0]).toEqual({
      id: "a",
      type: "text",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: "hi",
    });
  });

  it("uses tab indentation and a trailing newline", () => {
    const out = serializeCanvas({ nodes: [], edges: [] });
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain("\t");
  });

  it("round-trips parse → serialize → parse", () => {
    const source: CanvasData = {
      nodes: [
        { id: "t", type: "text", x: 1, y: 2, width: 3, height: 4, text: "x", color: "2" },
        { id: "f", type: "file", x: 0, y: 0, width: 5, height: 5, file: "a.md", subpath: "#h" },
        { id: "g", type: "group", x: -10, y: -10, width: 99, height: 99, label: "G" },
      ],
      edges: [{ id: "e", fromNode: "t", toNode: "f", fromSide: "right", toSide: "left" }],
    };
    const reparsed = parseCanvas(serializeCanvas(source));
    expect(reparsed).toEqual(source);
  });
});
