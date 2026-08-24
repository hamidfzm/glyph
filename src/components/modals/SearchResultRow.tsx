import { useEffect, useRef } from "react";
import type { SearchMatch } from "@/lib/workspaceSearch";

interface SearchResultRowProps {
  match: SearchMatch;
  selected: boolean;
  onOpen: () => void;
  onHover: () => void;
}

export function SearchResultRow({ match, selected, onOpen, onHover }: SearchResultRowProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Keep the arrow-key selection visible in a list that scrolls.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      className="workspace-search-row"
      data-selected={selected ? "true" : undefined}
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
      // The visible input keeps focus while arrow keys drive selection: rows
      // are pointer-actionable but never the keyboard's focus target.
      tabIndex={-1}
    >
      <span className="workspace-search-line">{match.line}</span>
      <span className="workspace-search-snippet">
        {match.before}
        <mark className="workspace-search-mark">{match.text}</mark>
        {match.after}
      </span>
    </button>
  );
}
