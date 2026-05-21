import { describe, expect, it } from "vitest";
import { adaptMmdContent, isMermaidContent, wrapAsMermaid } from "./mmd";

describe("isMermaidContent", () => {
  it("returns false for empty content", () => {
    expect(isMermaidContent("")).toBe(false);
    expect(isMermaidContent("\n\n  \n")).toBe(false);
  });

  it("returns false when every line is a Mermaid comment", () => {
    expect(isMermaidContent("%% just notes\n%% more notes\n")).toBe(false);
  });

  it("recognises flowchart, graph, sequenceDiagram, classDiagram", () => {
    expect(isMermaidContent("flowchart TD\nA --> B")).toBe(true);
    expect(isMermaidContent("graph LR\nA --> B")).toBe(true);
    expect(isMermaidContent("sequenceDiagram\nAlice ->> Bob: hi")).toBe(true);
    expect(isMermaidContent("classDiagram\nclass Animal")).toBe(true);
  });

  it("recognises bare diagram keywords with no direction", () => {
    expect(isMermaidContent("pie\n\"a\": 1\n\"b\": 2")).toBe(true);
    expect(isMermaidContent("mindmap\n  root\n    a\n    b")).toBe(true);
  });

  it("recognises diagrams after leading blanks and comments", () => {
    expect(
      isMermaidContent("\n%% title: my graph\n\nflowchart LR\nA --> B"),
    ).toBe(true);
  });

  it("returns false for prose that happens to contain a keyword", () => {
    expect(isMermaidContent("This is a graphical representation.")).toBe(false);
    expect(isMermaidContent("# flowchart\n\nSome text.")).toBe(false);
  });

  it("returns false for markdown content without a Mermaid declaration", () => {
    expect(isMermaidContent("# Hello\n\nSome paragraph.")).toBe(false);
    expect(isMermaidContent("- bullet\n- another")).toBe(false);
  });

  it("matches even with leading whitespace inside the first line", () => {
    // We trim before comparing, so a tab/space-indented declaration counts.
    expect(isMermaidContent("   sequenceDiagram\nAlice ->> Bob")).toBe(true);
  });
});

describe("wrapAsMermaid", () => {
  it("wraps content in a mermaid fence", () => {
    const result = wrapAsMermaid("flowchart TD\nA --> B");
    expect(result.startsWith("```mermaid\n")).toBe(true);
    expect(result.includes("flowchart TD\nA --> B")).toBe(true);
    expect(result.trimEnd().endsWith("```")).toBe(true);
  });

  it("strips trailing whitespace before the closing fence", () => {
    const result = wrapAsMermaid("flowchart\nA --> B\n\n");
    expect(result).toBe("```mermaid\nflowchart\nA --> B\n```\n");
  });
});

describe("adaptMmdContent", () => {
  it("leaves non-mmd paths untouched", () => {
    const md = "# heading";
    expect(adaptMmdContent("notes.md", md)).toBe(md);
    expect(adaptMmdContent("/path/to/notes.markdown", "graph")).toBe("graph");
  });

  it("wraps .mmd Mermaid content in a fence", () => {
    const result = adaptMmdContent("diagram.mmd", "flowchart TD\nA --> B");
    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart TD");
  });

  it("returns .mmd MultiMarkdown content unchanged", () => {
    const md = "# MMD Note\n\nSome MultiMarkdown body.";
    expect(adaptMmdContent("note.mmd", md)).toBe(md);
  });

  it("is case-insensitive on the extension", () => {
    const result = adaptMmdContent("DIAGRAM.MMD", "pie\n\"a\": 1");
    expect(result).toContain("```mermaid");
  });
});
