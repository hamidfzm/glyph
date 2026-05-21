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

  it("accepts every case combination of .md and .mmd", () => {
    // Weird-cased filesystems (macOS HFS+, USB sticks) shouldn't trip us up.
    for (const ext of ["md", "mD", "Md", "MD"]) {
      expect(isMarkdownFile(`readme.${ext}`)).toBe(true);
    }
    for (const ext of ["mmd", "mmD", "mMd", "mMD", "Mmd", "MmD", "MMd", "MMD"]) {
      expect(isMarkdownFile(`diagram.${ext}`)).toBe(true);
    }
  });

  it("recognises mmd files (MultiMarkdown / Mermaid source)", () => {
    expect(isMarkdownFile("diagram.mmd")).toBe(true);
    expect(isMarkdownFile("notes.mmd")).toBe(true);
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
