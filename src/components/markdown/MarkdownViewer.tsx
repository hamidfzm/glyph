import { useEffect, useRef } from "react";
import { useSearch } from "@/hooks/useSearch";
import { SearchBar } from "../layout/SearchBar";
import { MarkdownContent } from "./MarkdownContent";

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  workspaceFiles?: string[];
  onOpenWikilink?: (path: string, heading?: string) => void;
  onTaskToggle?: (line: number) => void;
}

export function MarkdownViewer({
  content,
  filePath,
  initialScrollTop = 0,
  onScrollChange,
  searchOpen,
  onSearchClose,
  workspaceFiles,
  onOpenWikilink,
  onTaskToggle,
}: MarkdownViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const search = useSearch({ containerRef: contentRef });

  // Restore scroll position on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — restore once when tab activates
  useEffect(() => {
    const el = scrollRef.current;
    if (el && initialScrollTop > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = initialScrollTop;
      });
    }
  }, []);

  // Report scroll position changes to parent
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollChange) return;

    const handler = () => {
      onScrollChange(el.scrollTop);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScrollChange]);

  const handleSearchClose = () => {
    search.clear();
    onSearchClose();
  };

  return (
    <div className="flex-1 relative min-h-0 min-w-0">
      {searchOpen && (
        <SearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matchCount}
          currentMatch={search.currentMatch}
          onNext={search.nextMatch}
          onPrev={search.prevMatch}
          onClose={handleSearchClose}
        />
      )}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto"
        // Keep anchor targets a few pixels off the top edge when scrolled to
        // via TOC / `#anchor`. Extra scroll room past the last heading lives
        // on `.markdown-body` as `padding-bottom` so end-of-document targets
        // can still scroll to the top of the viewport.
        style={{ scrollPaddingTop: "16px" }}
      >
        <div ref={contentRef} className="markdown-body px-8 py-6">
          <MarkdownContent
            content={content}
            filePath={filePath}
            workspaceFiles={workspaceFiles}
            onOpenWikilink={onOpenWikilink}
            onTaskToggle={onTaskToggle}
          />
        </div>
      </div>
    </div>
  );
}
