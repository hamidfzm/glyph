import { describe, expect, it } from "vitest";
import { CANVAS_EXTENSIONS, isCanvasFile } from "./canvasExtensions";
import { isSupportedFile } from "./notebookExtensions";

describe("isCanvasFile", () => {
  it("matches .canvas files case-insensitively", () => {
    expect(isCanvasFile("board.canvas")).toBe(true);
    expect(isCanvasFile("BOARD.CANVAS")).toBe(true);
    expect(isCanvasFile("/a/b/notes.canvas")).toBe(true);
  });

  it("rejects non-canvas files", () => {
    expect(isCanvasFile("note.md")).toBe(false);
    expect(isCanvasFile("nb.ipynb")).toBe(false);
    expect(isCanvasFile("noext")).toBe(false);
  });

  it("exposes the canonical extension list", () => {
    expect(CANVAS_EXTENSIONS).toEqual(["canvas"]);
  });
});

describe("isSupportedFile", () => {
  it("now includes canvas files", () => {
    expect(isSupportedFile("board.canvas")).toBe(true);
    expect(isSupportedFile("note.md")).toBe(true);
    expect(isSupportedFile("nb.ipynb")).toBe(true);
    expect(isSupportedFile("image.png")).toBe(false);
  });
});
