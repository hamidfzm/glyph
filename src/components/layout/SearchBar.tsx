import { type KeyboardEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SearchCloseIcon } from "@/components/icons/SearchCloseIcon";
import { SearchNextIcon } from "@/components/icons/SearchNextIcon";
import { SearchPrevIcon } from "@/components/icons/SearchPrevIcon";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatch: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  onQueryChange,
  matchCount,
  currentMatch,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps) {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const noResults = query.length > 0 && matchCount === 0;

  return (
    <search className="search-bar">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
      />
      {query.length > 0 && (
        <span className="search-match-count" data-no-results={noResults}>
          {noResults
            ? t("search.noResults")
            : t("search.matchCount", { current: currentMatch, total: matchCount })}
        </span>
      )}
      <button
        type="button"
        className="search-nav-btn"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label={t("search.prevMatch")}
      >
        <SearchPrevIcon />
      </button>
      <button
        type="button"
        className="search-nav-btn"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label={t("search.nextMatch")}
      >
        <SearchNextIcon />
      </button>
      <button
        type="button"
        className="search-nav-btn"
        onClick={onClose}
        aria-label={t("search.close")}
      >
        <SearchCloseIcon />
      </button>
    </search>
  );
}
