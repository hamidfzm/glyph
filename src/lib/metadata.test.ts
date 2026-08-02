import { describe, expect, it } from "vitest";
import {
  buildMetadataIndex,
  type MetadataEntry,
  metadataFields,
  normalizeTag,
  pathsWithTag,
  tagCounts,
} from "./metadata";

function entry(overrides: Partial<MetadataEntry> = {}): MetadataEntry {
  return { path: "/ws/a.md", frontmatter: null, tags: [], ...overrides };
}

describe("normalizeTag", () => {
  it("strips leading hashes, trims, and lowercases", () => {
    expect(normalizeTag(" #Project/Alpha ")).toBe("project/alpha");
  });
});

describe("buildMetadataIndex", () => {
  it("merges frontmatter tags with inline tags", () => {
    const index = buildMetadataIndex([
      entry({
        frontmatter: "---\ntags: [Work, ideas]\n---\n",
        tags: ["ideas", "urgent"],
      }),
    ]);
    expect(index.get("/ws/a.md")?.tags).toEqual(["ideas", "urgent", "work"]);
  });

  it("indexes known and extra frontmatter fields by lowercased name", () => {
    const index = buildMetadataIndex([
      entry({ frontmatter: "---\nTitle: Note\nStatus: draft\nProject: Glyph\n---\n" }),
    ]);
    const fields = index.get("/ws/a.md")?.fields;
    expect(fields?.get("status")).toBe("draft");
    expect(fields?.get("project")).toBe("Glyph");
  });

  it("keeps the rendered header fields reachable", () => {
    const index = buildMetadataIndex([
      entry({ frontmatter: "---\ntitle: Release Notes\nauthor: Ada\ndate: 2026-01-02\n---\n" }),
    ]);
    const fields = index.get("/ws/a.md")?.fields;
    expect(fields?.get("title")).toBe("Release Notes");
    expect(fields?.get("author")).toBe("Ada");
    expect(fields?.get("date")).toBe("2026-01-02");
  });

  it("splits a comma-separated scalar tag list", () => {
    const index = buildMetadataIndex([entry({ frontmatter: "---\ntags: work, ideas\n---\n" })]);
    expect(index.get("/ws/a.md")?.tags).toEqual(["ideas", "work"]);
  });

  it("ignores a frontmatter tag that normalizes to nothing", () => {
    const index = buildMetadataIndex([entry({ frontmatter: '---\ntags: ["#", work]\n---\n' })]);
    expect(index.get("/ws/a.md")?.tags).toEqual(["work"]);
  });

  it("skips files whose frontmatter parses to nothing usable", () => {
    const index = buildMetadataIndex([entry({ frontmatter: "---\n: broken\n---\n" })]);
    expect(index.size).toBe(0);
  });

  it("ignores empty tags", () => {
    const index = buildMetadataIndex([entry({ tags: ["  ", "#"] })]);
    expect(index.size).toBe(0);
  });
});

describe("tagCounts", () => {
  it("orders by frequency, then name", () => {
    const index = buildMetadataIndex([
      entry({ path: "/ws/a.md", tags: ["work", "zebra"] }),
      entry({ path: "/ws/b.md", tags: ["work", "alpha"] }),
    ]);
    expect(tagCounts(index)).toEqual([
      { tag: "work", count: 2 },
      { tag: "alpha", count: 1 },
      { tag: "zebra", count: 1 },
    ]);
  });
});

describe("metadataFields", () => {
  it("collects every frontmatter field name in the workspace", () => {
    const index = buildMetadataIndex([
      entry({ path: "/ws/a.md", frontmatter: "---\nstatus: draft\n---\n" }),
      entry({ path: "/ws/b.md", frontmatter: "---\nProject: Glyph\n---\n" }),
      entry({ path: "/ws/c.md", tags: ["work"] }),
    ]);
    expect(metadataFields(index)).toEqual(new Set(["status", "project"]));
  });
});

describe("pathsWithTag", () => {
  it("matches the tag and its nested children, sorted", () => {
    const index = buildMetadataIndex([
      entry({ path: "/ws/b.md", tags: ["work/urgent"] }),
      entry({ path: "/ws/a.md", tags: ["work"] }),
      entry({ path: "/ws/c.md", tags: ["workshop"] }),
    ]);
    expect(pathsWithTag(index, "#Work")).toEqual(["/ws/a.md", "/ws/b.md"]);
  });
});
