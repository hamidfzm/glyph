import { useMemo } from "react";

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function useTableOfContents(content: string | null): TocEntry[] {
  return useMemo(() => {
    if (!content) return [];

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const entries: TocEntry[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      entries.push({
        id: slugify(match[2]),
        text: match[2],
        level: match[1].length,
      });
    }

    return entries;
  }, [content]);
}
