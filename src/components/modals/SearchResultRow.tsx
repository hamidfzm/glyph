import type { SearchMatch } from "@/lib/workspaceSearch";

interface SearchResultRowProps {
  match: SearchMatch;
  onOpen: () => void;
}

export function SearchResultRow({ match, onOpen }: SearchResultRowProps) {
  return (
    <button type="button" className="workspace-search-row" onClick={onOpen}>
      <span className="workspace-search-line">{match.line}</span>
      <span className="workspace-search-snippet">
        {match.before}
        <mark className="workspace-search-mark">{match.text}</mark>
        {match.after}
      </span>
    </button>
  );
}
