import GithubSlugger from "github-slugger";
import { useMemo } from "react";
import { parseHeadings } from "@/lib/markdownHeadings";

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export function useTableOfContents(content: string | null): TocEntry[] {
  return useMemo(() => {
    if (!content) return [];

    // Slug empty headings too before dropping them, so duplicate-id suffixes match the renderer's.
    const slugger = new GithubSlugger();
    return parseHeadings(content)
      .map(({ text, level }) => ({ id: slugger.slug(text), text, level }))
      .filter((entry) => entry.text);
  }, [content]);
}
