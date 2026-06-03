import { describe, expect, it } from "vitest";
import { deriveExportMeta } from "./meta";

describe("deriveExportMeta", () => {
  it("uses the source filename (without extension) for the base name and title", () => {
    const meta = deriveExportMeta("/docs/My Notes.md", "# hi");
    expect(meta).toEqual({ baseName: "My Notes", title: "My Notes", author: undefined });
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
