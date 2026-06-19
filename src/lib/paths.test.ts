import { describe, expect, it } from "vitest";
import { basename, isPathInside, parentDir, pruneInside } from "./paths";

describe("basename", () => {
  it("returns the final segment of a posix path", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
  });

  it("returns the final segment of a windows path", () => {
    expect(basename("a\\b\\c.md")).toBe("c.md");
  });

  it("returns the input unchanged when there is no directory", () => {
    expect(basename("c.md")).toBe("c.md");
  });
});

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

describe("pruneInside", () => {
  it("removes the base and its descendants, keeping unrelated keys", () => {
    const removed: string[] = [];
    pruneInside(["/a/b", "/a/b/c.md", "/a/x"], "/a/b", (k) => removed.push(k));
    expect(removed).toEqual(["/a/b", "/a/b/c.md"]);
  });

  it("removes nothing when no key is inside the base", () => {
    const removed: string[] = [];
    pruneInside(["/x", "/y/z"], "/a/b", (k) => removed.push(k));
    expect(removed).toEqual([]);
  });
});
