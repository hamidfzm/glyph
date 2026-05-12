import { describe, expect, it } from "vitest";
import { isMarkdownFile, MARKDOWN_EXTENSIONS } from "./markdownExtensions";

describe("MARKDOWN_EXTENSIONS", () => {
  it("includes at least the common markdown extensions", () => {
    expect(MARKDOWN_EXTENSIONS).toContain("md");
    expect(MARKDOWN_EXTENSIONS).toContain("markdown");
  });
});

describe("isMarkdownFile", () => {
  it("matches a markdown extension", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("notes.markdown")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isMarkdownFile("Notes.MD")).toBe(true);
    expect(isMarkdownFile("doc.Markdown")).toBe(true);
  });

  it("rejects non-markdown extensions", () => {
    expect(isMarkdownFile("file.txt")).toBe(false);
    expect(isMarkdownFile("style.css")).toBe(false);
  });

  it("rejects files with no extension", () => {
    expect(isMarkdownFile("Makefile")).toBe(false);
    expect(isMarkdownFile("")).toBe(false);
  });

  it("uses the last extension segment for dotted paths", () => {
    expect(isMarkdownFile("/path/to/notes.md")).toBe(true);
    expect(isMarkdownFile("a.b.c.md")).toBe(true);
    expect(isMarkdownFile("README.md.bak")).toBe(false);
  });
});
