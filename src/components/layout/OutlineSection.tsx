import { useCallback } from "react";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { scrollToHeading } from "@/lib/scrollToHeading";

// The document outline: a flat, indented list of headings that scrolls the
// active one into view and highlights whichever heading is currently active.
export function OutlineSection({ entries, activeId }: { entries: TocEntry[]; activeId: string }) {
  const scrollTo = useCallback((id: string) => {
    scrollToHeading(id);
  }, []);

  if (entries.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => scrollTo(entry.id)}
            className={`w-full text-left text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors ${
              activeId === entry.id
                ? "bg-[var(--color-accent)] text-white font-medium"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
            }`}
            style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
            title={entry.text}
          >
            {entry.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
