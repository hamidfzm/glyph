import { describe, expect, it } from "vitest";
import { filterBacklinks, type WikilinkRef } from "./backlinks";

const workspaceFiles = [
  "/workspace/Index.md",
  "/workspace/Notes/Cooking.md",
  "/workspace/Notes/Travel.md",
];

function ref(source: string, target: string, line = 1, snippet = `see [[${target}]]`): WikilinkRef {
  return { source, target, line, snippet };
}

describe("filterBacklinks", () => {
  it("returns refs that resolve to the current file", () => {
    const refs = [
      ref("/workspace/Index.md", "Cooking"),
      ref("/workspace/Notes/Travel.md", "Cooking"),
      ref("/workspace/Index.md", "Travel"),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result.map((b) => b.source)).toEqual([
      "/workspace/Index.md",
      "/workspace/Notes/Travel.md",
    ]);
  });

  it("drops self-links", () => {
    const refs = [ref("/workspace/Notes/Cooking.md", "Cooking")];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result).toEqual([]);
  });

  it("respects target syntax variants", () => {
    const refs = [
      ref("/workspace/Index.md", "Cooking|kitchen", 1),
      ref("/workspace/Index.md", "Cooking#Recipes", 2),
      ref("/workspace/Index.md", "Cooking.md", 3),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result).toHaveLength(3);
  });

  it("collapses several same-line links to the current file into one row", () => {
    // A single source line can mention the same target twice; the panel should
    // surface it once (and never emit duplicate `source:line` React keys).
    const refs = [
      ref("/workspace/Index.md", "Cooking", 3),
      ref("/workspace/Index.md", "Cooking|kitchen", 3),
      ref("/workspace/Index.md", "Cooking", 9),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result.map((b) => [b.source, b.line])).toEqual([
      ["/workspace/Index.md", 3],
      ["/workspace/Index.md", 9],
    ]);
  });

  it("ignores refs whose target resolves elsewhere", () => {
    const refs = [
      ref("/workspace/Index.md", "Travel"),
      ref("/workspace/Notes/Cooking.md", "Travel"),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result).toEqual([]);
  });

  it("returns empty when there is no current file or workspace", () => {
    const refs = [ref("/workspace/Index.md", "Cooking")];
    expect(filterBacklinks(refs, workspaceFiles, "")).toEqual([]);
    expect(filterBacklinks(refs, [], "/workspace/Notes/Cooking.md")).toEqual([]);
  });

  it("sorts by source filename then line", () => {
    const refs = [
      ref("/workspace/Notes/Travel.md", "Cooking", 7),
      ref("/workspace/Index.md", "Cooking", 12),
      ref("/workspace/Index.md", "Cooking", 4),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/workspace/Notes/Cooking.md");
    expect(result.map((b) => [b.source, b.line])).toEqual([
      ["/workspace/Index.md", 4],
      ["/workspace/Index.md", 12],
      ["/workspace/Notes/Travel.md", 7],
    ]);
  });
});
