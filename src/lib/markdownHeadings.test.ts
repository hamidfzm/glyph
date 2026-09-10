import { describe, expect, it } from "vitest";
import { parseHeadings } from "./markdownHeadings";

const spaces = " ".repeat(200_000);

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

  it.each([
    ["## Heading ##", "Heading"],
    ["# C#", "C#"],
    ["# #", ""],
    ["# Title #  ", "Title"],
  ])("reads %j as %j", (md, text) => {
    expect(parseHeadings(md)[0].text).toBe(text);
  });

  it.each([
    ["a long space run inside the text", `# a${spaces}b`, `a${spaces}b`],
    ["a long space run before U+2028", `# ${spaces}a\u2028`, "a"],
  ])("parses %s in linear time", (_, md, text) => {
    const started = performance.now();
    expect(parseHeadings(md)[0].text).toBe(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("strips trailing hashes from closed ATX headings", () => {
    expect(parseHeadings("# Title #").map((h) => h.text)).toEqual(["Title"]);
  });
});
