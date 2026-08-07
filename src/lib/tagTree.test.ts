import { describe, expect, it } from "vitest";
import type { TagCount } from "./metadata";
import { buildTagTree } from "./tagTree";

// The shape `tagCounts` produces: every ancestor present, parents counting
// every file under them.
const tags: TagCount[] = [
  { tag: "project", count: 3 },
  { tag: "project/glyph", count: 2 },
  { tag: "project/glyph/ui", count: 1 },
  { tag: "project/atlas", count: 1 },
  { tag: "work", count: 5 },
];

describe("buildTagTree", () => {
  it("nests each tag under its parent and labels it with the last segment", () => {
    const roots = buildTagTree(tags, "name");
    expect(roots.map((n) => n.tag)).toEqual(["project", "work"]);

    const project = roots[0];
    expect(project.children.map((n) => n.label)).toEqual(["atlas", "glyph"]);
    expect(project.children[1].children.map((n) => n.tag)).toEqual(["project/glyph/ui"]);
    expect(project.children[1].children[0].label).toBe("ui");
  });

  it("orders every level by name", () => {
    const roots = buildTagTree(
      [
        { tag: "zebra", count: 1 },
        { tag: "alpha", count: 9 },
        { tag: "alpha/zulu", count: 1 },
        { tag: "alpha/kilo", count: 8 },
      ],
      "name",
    );
    expect(roots.map((n) => n.tag)).toEqual(["alpha", "zebra"]);
    expect(roots[0].children.map((n) => n.tag)).toEqual(["alpha/kilo", "alpha/zulu"]);
  });

  it("orders every level by count, ties broken by name", () => {
    const roots = buildTagTree(
      [
        { tag: "alpha", count: 1 },
        { tag: "zebra", count: 1 },
        { tag: "work", count: 5 },
        { tag: "work/urgent", count: 1 },
        { tag: "work/later", count: 4 },
      ],
      "count",
    );
    expect(roots.map((n) => n.tag)).toEqual(["work", "alpha", "zebra"]);
    expect(roots[0].children.map((n) => n.tag)).toEqual(["work/later", "work/urgent"]);
  });

  it("keeps a tag whose parent is missing at the root under its full path", () => {
    const roots = buildTagTree([{ tag: "project/glyph", count: 1 }], "name");
    expect(roots).toHaveLength(1);
    expect(roots[0].label).toBe("project/glyph");
  });

  it("returns nothing for an empty workspace", () => {
    expect(buildTagTree([], "name")).toEqual([]);
  });
});
