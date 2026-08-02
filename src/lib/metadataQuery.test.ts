import { describe, expect, it } from "vitest";
import { buildMetadataIndex, metadataFields } from "./metadata";
import { matchesFilters, parseMetadataQuery } from "./metadataQuery";

const index = buildMetadataIndex([
  {
    path: "/ws/draft.md",
    frontmatter: "---\nstatus: Draft\nproject: Glyph Docs\n---\n",
    tags: ["work/urgent"],
  },
  { path: "/ws/plain.md", frontmatter: null, tags: ["personal"] },
]);

const fields = new Set(["status", "project"]);

describe("parseMetadataQuery", () => {
  it("pulls out field filters and leaves the rest as text", () => {
    expect(parseMetadataQuery("tag:work release notes")).toEqual({
      filters: [{ field: "tag", value: "work" }],
      text: "release notes",
    });
  });

  it("closes the gap a filter leaves mid-query", () => {
    expect(parseMetadataQuery("release tag:work notes")).toEqual({
      filters: [{ field: "tag", value: "work" }],
      text: "release notes",
    });
  });

  it("only treats a term as a filter when the workspace uses that field", () => {
    expect(parseMetadataQuery("status:draft", fields).filters).toEqual([
      { field: "status", value: "draft" },
    ]);
    // A pasted Windows path or a `Heading:Sub` term stays plain search text.
    expect(parseMetadataQuery("C:\\notes\\release")).toEqual({
      filters: [],
      text: "C:\\notes\\release",
    });
  });

  it("accepts quoted values with spaces", () => {
    expect(parseMetadataQuery('project:"side quest"', fields).filters).toEqual([
      { field: "project", value: "side quest" },
    ]);
  });

  it("lowercases fields and values", () => {
    expect(parseMetadataQuery("Status:DRAFT", fields).filters).toEqual([
      { field: "status", value: "draft" },
    ]);
  });

  it("leaves a bare colon alone", () => {
    expect(parseMetadataQuery('note: "" here')).toEqual({ filters: [], text: 'note: "" here' });
  });

  it("keeps an empty quoted value as plain text instead of a filter", () => {
    expect(parseMetadataQuery('tag:"" notes')).toEqual({ filters: [], text: 'tag:"" notes' });
  });

  it("returns the query untouched when there is no filter", () => {
    expect(parseMetadataQuery("release notes")).toEqual({ filters: [], text: "release notes" });
  });
});

describe("matchesFilters", () => {
  const filters = (query: string) => parseMetadataQuery(query, metadataFields(index)).filters;

  it("passes everything when there are no filters", () => {
    expect(matchesFilters(index, "/ws/unknown.md", [])).toBe(true);
  });

  it("matches a tag and its nested children", () => {
    expect(matchesFilters(index, "/ws/draft.md", filters("tag:work"))).toBe(true);
    expect(matchesFilters(index, "/ws/plain.md", filters("tags:work"))).toBe(false);
  });

  it("matches a frontmatter field case-insensitively by substring", () => {
    expect(matchesFilters(index, "/ws/draft.md", filters("project:glyph"))).toBe(true);
    expect(matchesFilters(index, "/ws/draft.md", filters("status:draft"))).toBe(true);
    expect(matchesFilters(index, "/ws/draft.md", filters("status:done"))).toBe(false);
  });

  it("requires every filter to match", () => {
    expect(matchesFilters(index, "/ws/draft.md", filters("tag:work status:draft"))).toBe(true);
    expect(matchesFilters(index, "/ws/draft.md", filters("tag:work status:done"))).toBe(false);
  });

  it("rejects files missing from the index", () => {
    expect(matchesFilters(index, "/ws/unindexed.md", filters("tag:work"))).toBe(false);
  });

  it("rejects a field the file does not carry", () => {
    expect(matchesFilters(index, "/ws/plain.md", filters("status:draft"))).toBe(false);
  });
});
