import { describe, expect, it } from "vitest";
import { isNotebookFile, isSupportedFile } from "./notebookExtensions";

describe("isNotebookFile", () => {
  it("matches .ipynb case-insensitively", () => {
    expect(isNotebookFile("analysis.ipynb")).toBe(true);
    expect(isNotebookFile("ANALYSIS.IPYNB")).toBe(true);
    expect(isNotebookFile("/path/to/Untitled.ipynb")).toBe(true);
  });

  it("rejects non-notebook files", () => {
    expect(isNotebookFile("readme.md")).toBe(false);
    expect(isNotebookFile("data.json")).toBe(false);
    expect(isNotebookFile("noext")).toBe(false);
  });

  it("rejects an empty path (no extension segment)", () => {
    expect(isNotebookFile("")).toBe(false);
  });
});

describe("isSupportedFile", () => {
  it("accepts both markdown and notebooks", () => {
    expect(isSupportedFile("readme.md")).toBe(true);
    expect(isSupportedFile("notes.markdown")).toBe(true);
    expect(isSupportedFile("analysis.ipynb")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isSupportedFile("image.png")).toBe(false);
    expect(isSupportedFile("script.py")).toBe(false);
  });
});
