import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabsContext } from "@/contexts/TabsContext";
import { locateLineInDocument, locateWhenRendered } from "@/lib/documentHighlight";
import { relativeToRoot } from "@/lib/paths";
import type { SearchMatch, SearchOptions, SearchResults } from "@/lib/workspaceSearch";
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [locateFailed, setLocateFailed] = useState(false);
  const cancelLocateRef = useRef<(() => void) | null>(null);

  // Flat view of the grouped results, in render order, for arrow-key stepping.
  const hits = useMemo(
    () =>
      results.files.flatMap((file) => file.matches.map((match) => ({ path: file.path, match }))),
    [results],
  );

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setLocateFailed(false);
    }
  }, [open]);

  // Reset selection when the result set changes so the top hit is primed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // A pending jump outlives a closed panel on purpose (the user may close the
  // overlay right after clicking a hit); only unmount abandons it.
  useEffect(() => () => cancelLocateRef.current?.(), []);

  if (!open) return null;

  // The panel stays open so one query can answer several "where else" clicks;
  // Escape or the backdrop dismiss it.
  const handleOpenMatch = (path: string, match: SearchMatch) => {
    setLocateFailed(false);
    cancelLocateRef.current?.();
    openFile(path);
    cancelLocateRef.current = locateWhenRendered(
      () => locateLineInDocument(match.line, match.text),
      () => setLocateFailed(true),
    );
    inputRef.current?.focus();
  };

  // On the input only; the overlay's own handler covers Escape elsewhere so a
  // bubbled key never runs both (Enter would open the selection twice).
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, hits.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) handleOpenMatch(hit.path, hit.match);
    }
  };

  const handleOverlayKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
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

    // Rows are grouped by file but selected by flat index, so each file block
    // needs its offset into the flat list.
    const offsets = new Map<string, number>();
    let total = 0;
    for (const file of results.files) {
      offsets.set(file.path, total);
      total += file.matches.length;
    }

    return results.files.map((file) => (
      <div key={file.path} className="command-palette-group">
        <div className="command-palette-section" title={file.path}>
          {relativeToRoot(file.path, workspace.root)}
          <span className="workspace-search-count">{file.matches.length}</span>
        </div>
        {file.matches.map((match, i) => {
          const index = (offsets.get(file.path) ?? 0) + i;
          return (
            <SearchResultRow
              key={`${match.line}:${match.column}`}
              match={match}
              selected={selectedIndex === index}
              onOpen={() => handleOpenMatch(file.path, match)}
              onHover={() => setSelectedIndex(index)}
            />
          );
        })}
      </div>
    ));
  };

  return (
    <div
      className="command-palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleOverlayKeyDown}
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
            onKeyDown={handleKeyDown}
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
        {locateFailed && (
          <div className="workspace-search-truncated">{t("workspaceSearch.locateFailed")}</div>
        )}
        {results.truncated && (
          <div className="workspace-search-truncated">{t("workspaceSearch.truncated")}</div>
        )}
      </div>
    </div>
  );
}
