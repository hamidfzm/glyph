import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type MarkdownHeading, parseHeadings } from "./markdownHeadings";

describe("parseHeadings", () => {
  it("returns level, text, and line for each heading", () => {
    expect(parseHeadings("# One\ntext\n## Two")).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 2, text: "Two", line: 2 },
    ]);
  });

  it("skips # lines inside backtick fences", () => {
    const md = "# Title\n```python\n# not a heading\n```\n## Real";
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["Title", "Real"]);
  });

  it("skips # lines inside tilde fences", () => {
    const md = "# Title\n~~~\n# nope\n~~~\n## Real";
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["Title", "Real"]);
  });

  it("does not let a tilde line close a backtick fence", () => {
    const md = "```\n~~~\n# still code\n```\n# Real";
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["Real"]);
  });

  it("strips trailing hashes from closed ATX headings", () => {
    expect(parseHeadings("# Title #").map((h) => h.text)).toEqual(["Title"]);
  });
});

// The MCP server's Rust index ports this parser (`src-tauri/src/vault/headings.rs`).
// Both are held to `vault-headings.json`, so a change to either fails here and in
// `vault::tests::headings_match_the_shared_expectation` together.
describe("the shared fixture vault", () => {
  const fixtures = path.join(process.cwd(), "src-tauri", "fixtures");
  const expected: { note: string; headings: MarkdownHeading[] } = JSON.parse(
    readFileSync(path.join(fixtures, "vault-headings.json"), "utf-8"),
  );

  it("parses the headings the Rust index does", () => {
    const content = readFileSync(path.join(fixtures, "vault", expected.note), "utf-8");
    // The Rust side numbers lines from 1, as link lines are.
    const oneBased = parseHeadings(content).map((h) => ({ ...h, line: h.line + 1 }));
    expect(oneBased).toEqual(expected.headings);
  });
});
