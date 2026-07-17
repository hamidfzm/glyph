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

    const slugger = new GithubSlugger();
    return parseHeadings(content)
      .filter((heading) => heading.text)
      .map(({ text, level }) => ({ id: slugger.slug(text), text, level }));
  }, [content]);
}
