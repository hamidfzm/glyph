import { readFileSync } from "node:fs";
import path from "node:path";
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

// The Rust index parses the same blocks in `src-tauri/src/vault/frontmatter.rs`.
// Both sides are held to `vault-frontmatter.json`, so a change to either parser
// fails here and in `vault::tests::frontmatter_matches_the_shared_expectation`
// together instead of drifting apart unnoticed.
describe("the shared fixture vault", () => {
  // Vitest runs from the package root, where its config lives.
  const fixtures = path.join(process.cwd(), "src-tauri", "fixtures");
  const expected: Record<
    string,
    {
      title?: string;
      author?: string;
      date?: string;
      tags?: string[];
      extra: [string, string][];
    } | null
  > = JSON.parse(readFileSync(path.join(fixtures, "vault-frontmatter.json"), "utf-8"));

  it.each(Object.keys(expected))("parses %s the way the Rust index does", (name) => {
    const content = readFileSync(path.join(fixtures, "vault", name), "utf-8");
    const parsed = parseFrontmatter(content);
    const want = expected[name];

    if (want === null) {
      expect(parsed).toBeNull();
      return;
    }
    expect(parsed?.title).toBe(want.title);
    expect(parsed?.author).toBe(want.author);
    expect(parsed?.date).toBe(want.date);
    expect(parsed?.tags ?? []).toEqual(want.tags ?? []);
    expect(parsed?.extra).toEqual(want.extra);
  });
});
