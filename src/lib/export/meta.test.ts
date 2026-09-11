import { describe, expect, it } from "vitest";
import { deriveExportMeta } from "./meta";

describe("deriveExportMeta", () => {
  it("uses the source filename (without extension) for the base name and title", () => {
    const meta = deriveExportMeta("/docs/My Notes.md", "plain text, no heading");
    expect(meta).toEqual({ baseName: "My Notes", title: "My Notes", author: undefined });
  });

  it("titles the document from its first h1 when there is no frontmatter title", () => {
    const meta = deriveExportMeta("/docs/getting-started.md", "intro\n\n# Getting Started\n\nbody");
    expect(meta.baseName).toBe("getting-started");
    expect(meta.title).toBe("Getting Started");
  });

  it("ignores h1-lookalikes inside code fences and yaml frontmatter", () => {
    const content = "---\nauthor: Ada\n---\n```sh\n# a comment\n```\n# Real Title\n";
    expect(deriveExportMeta("/x/raw.md", content).title).toBe("Real Title");
  });

  it("skips a frontmatter block that follows a BOM", () => {
    const content = "\uFEFF---\n# a yaml comment\nauthor: Ada\n---\n# Real Title\n";
    expect(deriveExportMeta("/x/bom.md", content).title).toBe("Real Title");
  });

  it("finds a first-line h1 behind a BOM", () => {
    const meta = deriveExportMeta("/x/getting-started.md", "\uFEFF# Getting Started\n\nbody");
    expect(meta.title).toBe("Getting Started");
  });

  it("skips a block whose fences carry trailing spaces or tabs", () => {
    const comment = "---\n# a yaml comment\nauthor: Ada\n---  \n# Real Title\n";
    expect(deriveExportMeta("/x/a.md", comment).title).toBe("Real Title");
    const laterBreak = "---\t\nauthor: Ada\n---  \n# Getting Started\n\n---\n\n# Appendix\n";
    expect(deriveExportMeta("/x/b.md", laterBreak).title).toBe("Getting Started");
  });

  it("strips simple inline markup from the h1 and skips deeper headings", () => {
    expect(deriveExportMeta("/x/a.md", "# The `ctx` *guide*").title).toBe("The ctx guide");
    expect(deriveExportMeta("/x/b.md", "# [API Reference](api.md)").title).toBe("API Reference");
    expect(deriveExportMeta("/x/c.md", "## Not a title\ntext").title).toBe("c");
    expect(deriveExportMeta("/x/d.md", "# ***\n# Real Heading").title).toBe("Real Heading");
  });

  it("handles Windows-style paths", () => {
    expect(deriveExportMeta("C:\\a\\b\\report.markdown", null).baseName).toBe("report");
  });

  it("prefers the frontmatter title for the document title but keeps the filename for the file name", () => {
    const content = "---\ntitle: Fancy Title\nauthor: Ada\n---\n# body";
    const meta = deriveExportMeta("/docs/raw.md", content);
    expect(meta.baseName).toBe("raw");
    expect(meta.title).toBe("Fancy Title");
    expect(meta.author).toBe("Ada");
  });

  it("falls back to defaults when there is no path or frontmatter", () => {
    expect(deriveExportMeta(undefined, null)).toEqual({
      baseName: "document",
      title: "Document",
      author: undefined,
    });
  });

  it("uses the frontmatter title as the base name when there is no path", () => {
    const meta = deriveExportMeta(undefined, "---\ntitle: Only Title\n---\n");
    expect(meta.baseName).toBe("Only Title");
  });

  it("titles a CRLF document from its first h1", () => {
    const content = "intro\r\n\r\n# Getting Started\r\n\r\nbody";
    expect(deriveExportMeta("/x/a.md", content).title).toBe("Getting Started");
  });

  it("keeps a `#` that belongs to the h1 text", () => {
    expect(deriveExportMeta("/x/a.md", "# C#").title).toBe("C#");
  });

  it("strips a link whose URL holds parens", () => {
    const content = "# [Foo](https://en.wikipedia.org/wiki/Foo_(bar))";
    expect(deriveExportMeta("/x/a.md", content).title).toBe("Foo");
  });

  it.each([
    ["a long space run", `# a${" ".repeat(200_000)}b`, `a${" ".repeat(200_000)}b`],
    ["unclosed link text brackets", `# ${"[".repeat(200_000)}`, "[".repeat(200_000)],
    ["unclosed link target parens", `# ${"[](".repeat(70_000)}`, "[](".repeat(70_000)],
    [
      "an unclosed link target of paren pairs",
      `# [a](${"(b)".repeat(70_000)}`,
      `[a](${"(b)".repeat(70_000)}`,
    ],
  ])("titles an h1 with %s in linear time", (_, content, title) => {
    const started = performance.now();
    expect(deriveExportMeta("/x/a.md", content).title).toBe(title);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
