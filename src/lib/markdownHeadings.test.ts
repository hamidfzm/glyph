import { describe, expect, it } from "vitest";
import { parseHeadings } from "./markdownHeadings";

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
