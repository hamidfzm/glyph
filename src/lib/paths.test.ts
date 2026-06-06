import { describe, expect, it } from "vitest";
import { isPathInside, parentDir } from "./paths";

describe("parentDir", () => {
  it("returns the directory of a nested posix path", () => {
    expect(parentDir("/a/b/c.md", "/root")).toBe("/a/b");
  });

  it("returns the directory of a nested windows path", () => {
    expect(parentDir("a\\b\\c.md", "/root")).toBe("a\\b");
  });

  it("falls back for a bare name with no separator", () => {
    expect(parentDir("c.md", "/root")).toBe("/root");
  });

  it("falls back when the only separator is at index 0", () => {
    expect(parentDir("/c.md", "/root")).toBe("/root");
  });
});

describe("isPathInside", () => {
  it("matches the base itself", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
  });

  it("matches a posix descendant", () => {
    expect(isPathInside("/a/b/c.md", "/a/b")).toBe(true);
  });

  it("matches a windows descendant", () => {
    expect(isPathInside("a\\b\\c.md", "a\\b")).toBe(true);
  });

  it("rejects an unrelated path", () => {
    expect(isPathInside("/x/y", "/a/b")).toBe(false);
  });

  it("rejects a sibling that only shares a name prefix", () => {
    expect(isPathInside("/a/bc", "/a/b")).toBe(false);
  });
});
