import { describe, expect, it } from "vitest";
import { dirOf, resolveWikilink, splitTargetAndHeading, stemOf } from "./wikilinkResolver";

describe("wikilinkResolver helpers", () => {
  it("splits target and heading", () => {
    expect(splitTargetAndHeading("note")).toEqual({ target: "note" });
    expect(splitTargetAndHeading("note#section")).toEqual({ target: "note", heading: "section" });
    expect(splitTargetAndHeading("note#  ")).toEqual({ target: "note" });
  });

  it("derives the file stem", () => {
    expect(stemOf("/a/b/Note.md")).toBe("Note");
    expect(stemOf("Note.markdown")).toBe("Note");
    expect(stemOf("Note")).toBe("Note");
    expect(stemOf("/a/.hidden")).toBe(".hidden");
  });

  it("derives the directory", () => {
    expect(dirOf("/a/b/Note.md")).toBe("/a/b");
    expect(dirOf("C:\\a\\Note.md")).toBe("C:\\a");
    expect(dirOf("Note.md")).toBe("");
  });
});

describe("resolveWikilink", () => {
  const files = [
    "/workspace/Index.md",
    "/workspace/Notes/Cooking.md",
    "/workspace/Notes/Travel.md",
    "/workspace/Archive/Travel.md",
  ];

  it("returns null when there are no workspace files", () => {
    expect(resolveWikilink("Note", []).path).toBeNull();
  });

  it("matches by stem case-insensitively", () => {
    expect(resolveWikilink("cooking", files).path).toBe("/workspace/Notes/Cooking.md");
    expect(resolveWikilink("INDEX", files).path).toBe("/workspace/Index.md");
  });

  it("strips a trailing .md", () => {
    expect(resolveWikilink("Cooking.md", files).path).toBe("/workspace/Notes/Cooking.md");
    expect(resolveWikilink("Cooking.MD", files).path).toBe("/workspace/Notes/Cooking.md");
  });

  it("returns null on no match", () => {
    expect(resolveWikilink("Missing", files).path).toBeNull();
  });

  it("returns the heading when present", () => {
    expect(resolveWikilink("Cooking#Recipes", files)).toEqual({
      path: "/workspace/Notes/Cooking.md",
      heading: "Recipes",
    });
  });

  it("disambiguates by current-file directory when names collide", () => {
    expect(resolveWikilink("Travel", files, "/workspace/Archive/today.md").path).toBe(
      "/workspace/Archive/Travel.md",
    );
    expect(resolveWikilink("Travel", files, "/workspace/Notes/today.md").path).toBe(
      "/workspace/Notes/Travel.md",
    );
  });

  it("falls back to shortest-path when no same-dir candidate", () => {
    expect(resolveWikilink("Travel", files, "/workspace/Other/today.md").path).toBe(
      "/workspace/Notes/Travel.md",
    );
  });

  it("matches by relative path suffix when target contains a slash", () => {
    expect(resolveWikilink("Notes/Travel", files).path).toBe("/workspace/Notes/Travel.md");
    expect(resolveWikilink("Archive/Travel", files).path).toBe("/workspace/Archive/Travel.md");
  });
});
