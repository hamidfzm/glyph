import { parseFrontmatter } from "@/lib/frontmatter";

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
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
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
