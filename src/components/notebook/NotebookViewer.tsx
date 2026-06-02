import { useEffect, useMemo, useRef } from "react";
import { useSearch } from "@/hooks/useSearch";
import { parseNotebook } from "@/lib/notebook/parseNotebook";
import { NotebookParseError } from "@/lib/notebook/types";
import { SearchBar } from "../layout/SearchBar";
import { NotebookCell } from "./NotebookCell";

interface NotebookViewerProps {
  /** Raw `.ipynb` JSON text. */
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
}

/** Stable, unique keys for cells without relying on the array index. */
function makeCellKeyer() {
  const seen = new Map<string, number>();
  return (type: string): string => {
    const ordinal = seen.get(type) ?? 0;
    seen.set(type, ordinal + 1);
    return `${type}#${ordinal}`;
  };
}

export function NotebookViewer({
  content,
  filePath,
  initialScrollTop = 0,
  onScrollChange,
  searchOpen,
  onSearchClose,
}: NotebookViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const search = useSearch({ containerRef: contentRef });

  const parsed = useMemo(() => {
    try {
      return { notebook: parseNotebook(content), error: null as string | null };
    } catch (err) {
      return {
        notebook: null,
        // parseNotebook only throws NotebookParseError; the String(err) arm is a
        // defensive fallback for any unexpected throw.
        /* c8 ignore next */
        error: err instanceof NotebookParseError ? err.message : String(err),
      };
    }
  }, [content]);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollChange) return;
    const handler = () => onScrollChange(el.scrollTop);
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScrollChange]);

  const handleSearchClose = () => {
    search.clear();
    onSearchClose();
  };

  const cellKey = makeCellKeyer();

  const renderBody = () => {
    if (parsed.error) {
      return (
        <div className="nb-error-state">
          <p className="nb-error-title">Couldn't render this notebook</p>
          <p className="nb-error-detail">{parsed.error}</p>
        </div>
      );
    }
    // On the non-error path the parser always returns a notebook.
    const notebook = parsed.notebook as NonNullable<typeof parsed.notebook>;
    if (notebook.cells.length === 0) {
      return <div className="nb-empty-state">This notebook has no cells.</div>;
    }
    return notebook.cells.map((cell) => (
      <NotebookCell
        key={cellKey(cell.type)}
        cell={cell}
        language={notebook.languageHint}
        filePath={filePath}
      />
    ));
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
        style={{ scrollPaddingTop: "16px" }}
      >
        <div ref={contentRef} className="notebook-body px-8 py-6">
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
