import { parseFrontmatter } from "@/lib/frontmatter";

export interface ExportMeta {
  // Default file name (no extension) for the save dialog.
  baseName: string;
  // Document title for <title>, EPUB/DOCX metadata.
  title: string;
  author?: string;
}

function basename(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Resolve the export file name, title, and author from the source path and the
 * document's frontmatter. The source filename wins for the default save name;
 * the frontmatter title wins for the document title.
 */
export function deriveExportMeta(filePath: string | undefined, content: string | null): ExportMeta {
  const fm = content ? parseFrontmatter(content) : null;
  const fileBase = filePath ? basename(filePath) : "";
  return {
    baseName: fileBase || fm?.title || "document",
    title: fm?.title || fileBase || "Document",
    author: fm?.author,
  };
}
