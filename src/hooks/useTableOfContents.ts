import GithubSlugger from "github-slugger";
import { useMemo } from "react";

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export function useTableOfContents(content: string | null): TocEntry[] {
  return useMemo(() => {
    if (!content) return [];

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const slugger = new GithubSlugger();
    const entries: TocEntry[] = [];

    for (const match of content.matchAll(headingRegex)) {
      const text = match[2];
      entries.push({
        id: slugger.slug(text),
        text,
        level: match[1].length,
      });
    }

    return entries;
  }, [content]);
}
