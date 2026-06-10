import { describe, expect, it } from "vitest";
import { canvasDisplayText } from "./canvasText";

describe("canvasDisplayText", () => {
  it("joins text cards, group labels, and link URLs in document order", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "# Title\nBody" },
        { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10, label: "Planning" },
        { id: "l", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://glyph.dev" },
        { id: "f", type: "file", x: 0, y: 0, width: 10, height: 10, file: "a.md" },
      ],
      edges: [],
    });
    expect(canvasDisplayText(content)).toBe("# Title\nBody\n\nPlanning\n\nhttps://glyph.dev");
  });

  it("returns null for an empty board", () => {
    expect(canvasDisplayText('{"nodes":[],"edges":[]}')).toBeNull();
  });

  it("skips empty labels and whitespace-only cards", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10, label: "" },
        { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "   " },
      ],
      edges: [],
    });
    expect(canvasDisplayText(content)).toBeNull();
  });

  it("treats a group without a label as contributing no text", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10 },
        { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "card" },
      ],
      edges: [],
    });
    expect(canvasDisplayText(content)).toBe("card");
  });

  it("returns null for invalid JSON", () => {
    expect(canvasDisplayText("{nope")).toBeNull();
  });
});
