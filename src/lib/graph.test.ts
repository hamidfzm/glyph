import { describe, expect, it } from "vitest";
import type { WikilinkRef } from "./backlinks";
import { buildWorkspaceGraph } from "./graph";

const FILES = ["/vault/a.md", "/vault/b.md", "/vault/notes/c.md", "/vault/orphan.md"];

function ref(source: string, target: string, line = 1): WikilinkRef {
  return { source, target, line, snippet: `[[${target}]]` };
}

describe("buildWorkspaceGraph", () => {
  it("returns the shared empty graph when there are no files", () => {
    const graph = buildWorkspaceGraph([], [ref("/vault/a.md", "b")]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.neighbors.size).toBe(0);
  });

  it("creates one node per file, labelled by stem", () => {
    const graph = buildWorkspaceGraph(FILES, []);
    expect(graph.nodes.map((n) => n.id)).toEqual(FILES);
    expect(graph.nodes.map((n) => n.label)).toEqual(["a", "b", "c", "orphan"]);
  });

  it("resolves wikilinks into directed edges", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "b")]);
    expect(graph.edges).toEqual([{ source: "/vault/a.md", target: "/vault/b.md" }]);
  });

  it("resolves targets in subdirectories by stem", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "c")]);
    expect(graph.edges).toEqual([{ source: "/vault/a.md", target: "/vault/notes/c.md" }]);
  });

  it("strips |alias from targets before resolving", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "b|Better Name")]);
    expect(graph.edges).toEqual([{ source: "/vault/a.md", target: "/vault/b.md" }]);
  });

  it("drops broken links", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "does-not-exist")]);
    expect(graph.edges).toEqual([]);
  });

  it("drops self-links", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "a")]);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.find((n) => n.id === "/vault/a.md")?.orphan).toBe(true);
  });

  it("drops refs whose source is not a workspace file", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/elsewhere/x.md", "b")]);
    expect(graph.edges).toEqual([]);
  });

  it("collapses parallel links between the same pair into one edge", () => {
    const graph = buildWorkspaceGraph(FILES, [
      ref("/vault/a.md", "b", 1),
      ref("/vault/a.md", "b", 9),
      ref("/vault/a.md", "b.md", 12),
    ]);
    expect(graph.edges).toHaveLength(1);
  });

  it("keeps reverse edges distinct from forward edges", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "b"), ref("/vault/b.md", "a")]);
    expect(graph.edges).toHaveLength(2);
  });

  it("marks unlinked files as orphans and linked files as connected", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "b")]);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("/vault/a.md")?.orphan).toBe(false);
    expect(byId.get("/vault/b.md")?.orphan).toBe(false);
    expect(byId.get("/vault/orphan.md")?.orphan).toBe(true);
  });

  it("counts distinct neighbors as degree, in either direction", () => {
    const graph = buildWorkspaceGraph(FILES, [
      ref("/vault/a.md", "b"),
      ref("/vault/a.md", "c"),
      ref("/vault/b.md", "a"),
    ]);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // a links to b and c; b's backlink to a adds no new neighbor.
    expect(byId.get("/vault/a.md")?.degree).toBe(2);
    expect(byId.get("/vault/b.md")?.degree).toBe(1);
    expect(byId.get("/vault/notes/c.md")?.degree).toBe(1);
    expect(byId.get("/vault/orphan.md")?.degree).toBe(0);
  });

  it("exposes an undirected adjacency map", () => {
    const graph = buildWorkspaceGraph(FILES, [ref("/vault/a.md", "b")]);
    expect(graph.neighbors.get("/vault/a.md")).toEqual(new Set(["/vault/b.md"]));
    expect(graph.neighbors.get("/vault/b.md")).toEqual(new Set(["/vault/a.md"]));
    expect(graph.neighbors.has("/vault/orphan.md")).toBe(false);
  });

  it("reuses cached resolutions for repeated targets from the same directory", () => {
    // Two refs to the same target from the same dir hit the memo; the result
    // must be identical either way.
    const graph = buildWorkspaceGraph(FILES, [
      ref("/vault/a.md", "c", 1),
      ref("/vault/b.md", "c", 2),
    ]);
    expect(graph.edges).toEqual([
      { source: "/vault/a.md", target: "/vault/notes/c.md" },
      { source: "/vault/b.md", target: "/vault/notes/c.md" },
    ]);
  });

  it("memoises per source directory so same-dir disambiguation still wins", () => {
    const files = [
      "/vault/x/note.md",
      "/vault/y/note.md",
      "/vault/x/from-x.md",
      "/vault/y/from-y.md",
    ];
    const graph = buildWorkspaceGraph(files, [
      ref("/vault/x/from-x.md", "note"),
      ref("/vault/y/from-y.md", "note"),
    ]);
    expect(graph.edges).toEqual([
      { source: "/vault/x/from-x.md", target: "/vault/x/note.md" },
      { source: "/vault/y/from-y.md", target: "/vault/y/note.md" },
    ]);
  });

  it("handles Windows-style paths", () => {
    const files = ["C:\\vault\\a.md", "C:\\vault\\b.md"];
    const graph = buildWorkspaceGraph(files, [
      { source: "C:\\vault\\a.md", target: "b", line: 1, snippet: "[[b]]" },
    ]);
    expect(graph.edges).toEqual([{ source: "C:\\vault\\a.md", target: "C:\\vault\\b.md" }]);
    expect(graph.nodes.map((n) => n.label)).toEqual(["a", "b"]);
  });
});
