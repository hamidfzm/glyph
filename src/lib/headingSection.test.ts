import { readFileSync } from "node:fs";
import path from "node:path";
import { slug } from "github-slugger";
import { describe, expect, it } from "vitest";
import { extractHeadingSection } from "./headingSection";

const DOC = [
  "# Intro",
  "top matter",
  "",
  "## Recipes",
  "pasta",
  "",
  "### Sauce",
  "tomato",
  "",
  "## Notes",
  "footer",
  "",
].join("\n");

describe("extractHeadingSection", () => {
  it("returns the heading and its body up to the next same-level heading", () => {
    expect(extractHeadingSection(DOC, "Recipes")).toBe("## Recipes\npasta\n\n### Sauce\ntomato");
  });

  it("includes nested deeper subheadings", () => {
    expect(extractHeadingSection(DOC, "Recipes")).toContain("### Sauce");
  });

  it("stops at a higher-level heading", () => {
    expect(extractHeadingSection(DOC, "Sauce")).toBe("### Sauce\ntomato");
  });

  it("matches by slug (case and spacing insensitive)", () => {
    expect(extractHeadingSection(DOC, "recipes")).toContain("pasta");
    const doc = "## My Heading\nbody";
    expect(extractHeadingSection(doc, "my-heading")).toBe("## My Heading\nbody");
  });

  it("returns empty when the heading is missing", () => {
    expect(extractHeadingSection(DOC, "Nope")).toBe("");
  });

  it("ignores headings inside fenced code blocks", () => {
    const doc = "## Real\ntext\n```\n## Fake\n```\nmore";
    expect(extractHeadingSection(doc, "Fake")).toBe("");
    expect(extractHeadingSection(doc, "Real")).toBe("## Real\ntext\n```\n## Fake\n```\nmore");
  });

  it("slices CRLF documents without leaking carriage returns", () => {
    const crlf = DOC.replaceAll("\n", "\r\n");
    expect(extractHeadingSection(crlf, "Recipes")).toBe("## Recipes\npasta\n\n### Sauce\ntomato");
    expect(extractHeadingSection(crlf, "Sauce")).toBe("### Sauce\ntomato");
  });

  it("finds a first-line heading behind a BOM", () => {
    expect(extractHeadingSection("\uFEFF# A\ntext\n# B\nmore", "A")).toBe("# A\ntext");
  });
});

// `read_note(ref, section)` slices in Rust (`src-tauri/src/vault/headings.rs`), so
// one rule has two implementations. Both are held to `vault-headings.json`,
// including the slugs, which github-slugger strips by a table the Rust side copies.
describe("the shared fixture vault", () => {
  const fixtures = path.join(process.cwd(), "src-tauri", "fixtures");
  const expected: {
    note: string;
    sections: { heading: string; section: string }[];
    slugs: { text: string; slug: string }[];
  } = JSON.parse(readFileSync(path.join(fixtures, "vault-headings.json"), "utf-8"));
  const content = readFileSync(path.join(fixtures, "vault", expected.note), "utf-8");

  it.each(expected.sections)("slices '$heading' the way the Rust index does", (c) => {
    expect(extractHeadingSection(content, c.heading)).toBe(c.section);
  });

  it.each(expected.slugs)("slugs '$text' the way the Rust index does", (c) => {
    expect(slug(c.text)).toBe(c.slug);
  });
});
