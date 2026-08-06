import { type KeyboardEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTabsContext } from "@/contexts/TabsContext";
import { locateWhenRendered } from "@/lib/documentHighlight";
import { relativeToRoot } from "@/lib/paths";
import type { SearchOptions, SearchResults } from "@/lib/workspaceSearch";
import { SearchResultRow } from "./SearchResultRow";
import { SearchToggle } from "./SearchToggle";

interface SearchPanelProps {
  open: boolean;
  query: string;
  options: SearchOptions;
  results: SearchResults;
  searching: boolean;
  failed: boolean;
  onQueryChange: (next: string) => void;
  onToggleOption: (key: keyof SearchOptions) => void;
  onClose: () => void;
}

export function SearchPanel({
  open,
  query,
  options,
  results,
  searching,
  failed,
  onQueryChange,
  onToggleOption,
  onClose,
}: SearchPanelProps) {
  const { t } = useTranslation("common");
  const { workspace, openFile } = useTabsContext();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleOpenMatch = (path: string, text: string) => {
    onClose();
    openFile(path);
    locateWhenRendered(text);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const renderBody = () => {
    if (!workspace)
      return <div className="command-palette-empty">{t("workspaceSearch.noWorkspace")}</div>;
    if (failed) {
      const message = options.regex ? "workspaceSearch.invalidPattern" : "workspaceSearch.failed";
      return <div className="command-palette-empty">{t(message)}</div>;
    }
    if (query.length === 0)
      return <div className="command-palette-empty">{t("workspaceSearch.prompt")}</div>;
    if (searching)
      return <div className="command-palette-empty">{t("workspaceSearch.searching")}</div>;
    if (results.total === 0)
      return <div className="command-palette-empty">{t("workspaceSearch.noResults")}</div>;

    return results.files.map((file) => (
      <div key={file.path} className="command-palette-group">
        <div className="command-palette-section" title={file.path}>
          {relativeToRoot(file.path, workspace.root)}
          <span className="workspace-search-count">{file.matches.length}</span>
        </div>
        {file.matches.map((match) => (
          <SearchResultRow
            key={`${match.line}:${match.column}`}
            match={match}
            onOpen={() => handleOpenMatch(file.path, match.text)}
          />
        ))}
      </div>
    ));
  };

  return (
    <div
      className="command-palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t("workspaceSearch.title")}
      data-print-hide="true"
    >
      <div className="command-palette workspace-search">
        <div className="workspace-search-header">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input workspace-search-input"
            placeholder={t("workspaceSearch.placeholder")}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label={t("workspaceSearch.queryLabel")}
          />
          <SearchToggle
            glyph="Aa"
            label={t("workspaceSearch.caseSensitive")}
            active={options.caseSensitive}
            onToggle={() => onToggleOption("caseSensitive")}
          />
          <SearchToggle
            glyph="ab"
            label={t("workspaceSearch.wholeWord")}
            active={options.wholeWord}
            onToggle={() => onToggleOption("wholeWord")}
          />
          <SearchToggle
            glyph=".*"
            label={t("workspaceSearch.regex")}
            active={options.regex}
            onToggle={() => onToggleOption("regex")}
          />
        </div>
        <div className="command-palette-results">{renderBody()}</div>
        {results.truncated && (
          <div className="workspace-search-truncated">{t("workspaceSearch.truncated")}</div>
        )}
      </div>
    </div>
  );
}
