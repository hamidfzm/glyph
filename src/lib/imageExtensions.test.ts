import { describe, expect, it } from "vitest";
import { IMAGE_EXTENSIONS, isImageFile, isSvgFile } from "./imageExtensions";
import { isSupportedFile } from "./notebookExtensions";

describe("isImageFile", () => {
  it("matches image and svg files case-insensitively", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("scan.JPG")).toBe(true);
    expect(isImageFile("frame.jpeg")).toBe(true);
    expect(isImageFile("loop.gif")).toBe(true);
    expect(isImageFile("shot.webp")).toBe(true);
    expect(isImageFile("old.bmp")).toBe(true);
    expect(isImageFile("diagram.SVG")).toBe(true);
    expect(isImageFile("next.avif")).toBe(true);
    expect(isImageFile("/a/b/favicon.ico")).toBe(true);
  });

  it("rejects non-image files", () => {
    expect(isImageFile("note.md")).toBe(false);
    expect(isImageFile("nb.ipynb")).toBe(false);
    expect(isImageFile("board.canvas")).toBe(false);
    expect(isImageFile("noext")).toBe(false);
    expect(isImageFile("")).toBe(false);
  });
});

describe("isSvgFile", () => {
  it("matches only svg files, case-insensitively", () => {
    expect(isSvgFile("diagram.svg")).toBe(true);
    expect(isSvgFile("/a/b/icon.SVG")).toBe(true);
    expect(isSvgFile("photo.png")).toBe(false);
    expect(isSvgFile("note.md")).toBe(false);
    expect(isSvgFile("noext")).toBe(false);
    expect(isSvgFile("")).toBe(false);
  });
});

describe("isSupportedFile vs images", () => {
  // Images are intentionally NOT documents: they stay out of the recursive
  // document index (graph, wikilinks). The file tree and openFile admit them
  // separately via isImageFile.
  it("does not treat images as supported documents", () => {
    expect(isSupportedFile("photo.png")).toBe(false);
    expect(isSupportedFile("diagram.svg")).toBe(false);
  });

  it("exposes the canonical extension list", () => {
    expect(IMAGE_EXTENSIONS).toContain("png");
    expect(IMAGE_EXTENSIONS).toContain("svg");
  });
});
