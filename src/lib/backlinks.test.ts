import { describe, expect, it } from "vitest";
import { filterBacklinks, type WikilinkRef } from "./backlinks";

const workspaceFiles = ["/vault/Index.md", "/vault/Notes/Cooking.md", "/vault/Notes/Travel.md"];

function ref(source: string, target: string, line = 1, snippet = `see [[${target}]]`): WikilinkRef {
  return { source, target, line, snippet };
}

describe("filterBacklinks", () => {
  it("returns refs that resolve to the current file", () => {
    const refs = [
      ref("/vault/Index.md", "Cooking"),
      ref("/vault/Notes/Travel.md", "Cooking"),
      ref("/vault/Index.md", "Travel"),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/vault/Notes/Cooking.md");
    expect(result.map((b) => b.source)).toEqual(["/vault/Index.md", "/vault/Notes/Travel.md"]);
  });

  it("drops self-links", () => {
    const refs = [ref("/vault/Notes/Cooking.md", "Cooking")];
    const result = filterBacklinks(refs, workspaceFiles, "/vault/Notes/Cooking.md");
    expect(result).toEqual([]);
  });

  it("respects target syntax variants", () => {
    const refs = [
      ref("/vault/Index.md", "Cooking|kitchen"),
      ref("/vault/Index.md", "Cooking#Recipes"),
      ref("/vault/Index.md", "Cooking.md"),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/vault/Notes/Cooking.md");
    expect(result).toHaveLength(3);
  });

  it("ignores refs whose target resolves elsewhere", () => {
    const refs = [ref("/vault/Index.md", "Travel"), ref("/vault/Notes/Cooking.md", "Travel")];
    const result = filterBacklinks(refs, workspaceFiles, "/vault/Notes/Cooking.md");
    expect(result).toEqual([]);
  });

  it("returns empty when there is no current file or workspace", () => {
    const refs = [ref("/vault/Index.md", "Cooking")];
    expect(filterBacklinks(refs, workspaceFiles, "")).toEqual([]);
    expect(filterBacklinks(refs, [], "/vault/Notes/Cooking.md")).toEqual([]);
  });

  it("sorts by source filename then line", () => {
    const refs = [
      ref("/vault/Notes/Travel.md", "Cooking", 7),
      ref("/vault/Index.md", "Cooking", 12),
      ref("/vault/Index.md", "Cooking", 4),
    ];
    const result = filterBacklinks(refs, workspaceFiles, "/vault/Notes/Cooking.md");
    expect(result.map((b) => [b.source, b.line])).toEqual([
      ["/vault/Index.md", 4],
      ["/vault/Index.md", 12],
      ["/vault/Notes/Travel.md", 7],
    ]);
  });
});
