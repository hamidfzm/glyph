import { describe, expect, it } from "vitest";
import { type FileState, makeFileState } from "@/lib/tabs";
import { canShareLink } from "./canShareLink";

function file(overrides: Partial<FileState>): FileState {
  return { ...makeFileState("/notes/readme.md", "view"), content: "# Hi", ...overrides };
}

describe("canShareLink", () => {
  it("accepts a loaded markdown file", () => {
    expect(canShareLink(file({}))).toBe(true);
    expect(canShareLink(file({ path: "/notes/flow.mmd" }))).toBe(true);
  });

  it("accepts an untitled document, whose path is only a title", () => {
    expect(canShareLink(file({ path: "Untitled-1", virtual: true, content: "" }))).toBe(true);
  });

  it.each([
    ["canvas", "/notes/board.canvas"],
    ["notebook", "/notes/analysis.ipynb"],
    ["D2 diagram", "/notes/arch.d2"],
    ["image", "/notes/photo.png"],
  ])("refuses a %s, which the viewer cannot render", (_name, path) => {
    expect(canShareLink(file({ path }))).toBe(false);
  });

  it("refuses a file still loading, and no tab at all", () => {
    expect(canShareLink(file({ content: null }))).toBe(false);
    expect(canShareLink(null)).toBe(false);
    expect(canShareLink(undefined)).toBe(false);
  });
});
