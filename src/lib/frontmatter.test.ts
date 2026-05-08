import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\n\nbody")).toBeNull();
  });

  it("returns null when frontmatter is not at the top of the file", () => {
    expect(parseFrontmatter("\n---\ntitle: x\n---\n")).toBeNull();
  });

  it("parses title, author, and date as raw strings", () => {
    const result = parseFrontmatter(
      "---\ntitle: My Note\nauthor: Glyph\ndate: 2026-04-15\n---\n\nbody",
    );
    expect(result).toEqual({
      title: "My Note",
      author: "Glyph",
      date: "2026-04-15",
      extra: [],
    });
  });

  it("parses tags from a flow sequence", () => {
    const result = parseFrontmatter("---\ntags: [markdown, demo, sample]\n---\n");
    expect(result?.tags).toEqual(["markdown", "demo", "sample"]);
  });

  it("parses tags from a block sequence", () => {
    const result = parseFrontmatter("---\ntags:\n  - one\n  - two\n---\n");
    expect(result?.tags).toEqual(["one", "two"]);
  });

  it("coerces a single string tag to a one-element array", () => {
    const result = parseFrontmatter("---\ntags: solo\n---\n");
    expect(result?.tags).toEqual(["solo"]);
  });

  it("collects unknown string keys into extra", () => {
    const result = parseFrontmatter("---\ntitle: t\nstatus: draft\nslug: my-note\n---\n");
    expect(result?.extra).toEqual([
      ["status", "draft"],
      ["slug", "my-note"],
    ]);
  });

  it("joins unknown sequence values with commas", () => {
    const result = parseFrontmatter("---\naliases: [Old Name, Older Name]\n---\n");
    expect(result?.extra).toEqual([["aliases", "Old Name, Older Name"]]);
  });

  it("preserves date strings verbatim", () => {
    // FAILSAFE schema keeps `2026-04-15` as a string instead of a Date object.
    const result = parseFrontmatter("---\ndate: 2026-04-15\n---\n");
    expect(result?.date).toBe("2026-04-15");
  });

  it("returns null on malformed YAML", () => {
    expect(parseFrontmatter("---\ntitle: [unclosed\n---\n")).toBeNull();
  });

  it("returns null when no displayable fields are present", () => {
    // Nested mappings are skipped; with no string/list values, nothing renders.
    expect(parseFrontmatter("---\nnested:\n  a: 1\n---\n")).toBeNull();
  });

  it("keeps numeric-looking scalars as strings (FAILSAFE schema)", () => {
    const result = parseFrontmatter("---\ncount: 42\n---\n");
    expect(result?.extra).toEqual([["count", "42"]]);
  });

  it("handles CRLF line endings", () => {
    const result = parseFrontmatter("---\r\ntitle: Win\r\n---\r\n\r\nbody");
    expect(result?.title).toBe("Win");
  });

  it("ignores empty title/author/date strings", () => {
    const result = parseFrontmatter("---\ntitle: ''\nauthor: ''\ndate: ''\nslug: x\n---\n");
    expect(result?.title).toBeUndefined();
    expect(result?.author).toBeUndefined();
    expect(result?.date).toBeUndefined();
    expect(result?.extra).toEqual([["slug", "x"]]);
  });
});
