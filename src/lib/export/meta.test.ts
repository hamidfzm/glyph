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

  it("strips simple inline markup from the h1 and skips deeper headings", () => {
    expect(deriveExportMeta("/x/a.md", "# The `ctx` *guide*").title).toBe("The ctx guide");
    expect(deriveExportMeta("/x/b.md", "# [API Reference](api.md)").title).toBe("API Reference");
    expect(deriveExportMeta("/x/c.md", "## Not a title\ntext").title).toBe("c");
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
});
