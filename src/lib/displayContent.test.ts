import { describe, expect, it } from "vitest";
import { displayContentFor, tocContentFor } from "./displayContent";

const board = JSON.stringify({
  nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "# Card heading" }],
  edges: [],
});

describe("displayContentFor", () => {
  it("passes markdown through unchanged", () => {
    expect(displayContentFor("/notes/a.md", "# Hi")).toBe("# Hi");
  });

  it("passes content through when there is no path", () => {
    expect(displayContentFor(undefined, "text")).toBe("text");
    expect(displayContentFor(undefined, null)).toBeNull();
  });

  it("suppresses notebooks entirely", () => {
    expect(displayContentFor("/nb/analysis.ipynb", '{"cells":[]}')).toBeNull();
  });

  it("projects a canvas board's prose", () => {
    expect(displayContentFor("/b/board.canvas", board)).toBe("# Card heading");
  });

  it("yields null for a canvas with no content yet", () => {
    expect(displayContentFor("/b/board.canvas", null)).toBeNull();
  });
});

describe("tocContentFor", () => {
  it("passes the display content through for markdown", () => {
    expect(tocContentFor("/notes/a.md", "# Hi")).toBe("# Hi");
  });

  it("keeps the outline empty for a canvas despite projected headings", () => {
    expect(tocContentFor("/b/board.canvas", "# Card heading")).toBeNull();
  });

  it("passes through when there is no path", () => {
    expect(tocContentFor(undefined, "x")).toBe("x");
  });
});
