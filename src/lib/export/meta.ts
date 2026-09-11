import { FRONTMATTER_RE, parseFrontmatter } from "@/lib/frontmatter";
import { parseHeadings } from "@/lib/markdownHeadings";

export interface ExportMeta {
  // Default file name (no extension) for the save dialog.
  baseName: string;
  // Document title for <title>, EPUB/DOCX metadata.
  title: string;
  author?: string;
}

function basename(path: string): string {
  // Strip the directory prefix (POSIX or Windows separators) then the extension.
  return path.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

/** First `# heading` outside code fences, stripped of simple inline markup. */
function firstHeadingTitle(content: string): string | null {
  // FRONTMATTER_RE takes a BOM only along with a block; a bare one would hide a line-1 h1.
  const body = content.replace(FRONTMATTER_RE, "").replace(/^\uFEFF/, "");
  for (const heading of parseHeadings(body)) {
    if (heading.level !== 1) continue;
    const text = heading.text
      // One level of URL parens (`Foo_(bar)`); runs exclude `[` and `(` so unclosed ones stay linear.
      .replace(/\[([^[\]]*)\]\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (text) return text;
  }
  return null;
}

/**
 * Resolve the export file name, title, and author from the source path and the
 * document's frontmatter. The source filename wins for the default save name;
 * the document title prefers the frontmatter title, then the first h1 (so nav
 * entries and browser tabs read "Getting Started", not "getting-started"),
 * then the filename.
 */
export function deriveExportMeta(filePath: string | undefined, content: string | null): ExportMeta {
  const fm = content ? parseFrontmatter(content) : null;
  const fileBase = filePath ? basename(filePath) : "";
  return {
    baseName: fileBase || fm?.title || "document",
    title: fm?.title || (content ? firstHeadingTitle(content) : null) || fileBase || "Document",
    author: fm?.author,
  };
}
