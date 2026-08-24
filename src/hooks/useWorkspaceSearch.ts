import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import {
  DEFAULT_SEARCH_OPTIONS,
  EMPTY_SEARCH_RESULTS,
  type SearchOptions,
  type SearchResults,
  searchWorkspace,
} from "@/lib/workspaceSearch";

// Long enough that typing a word doesn't walk the vault once per keystroke.
const DEBOUNCE_MS = 200;

export interface WorkspaceSearchController {
  open: boolean;
  query: string;
  options: SearchOptions;
  results: SearchResults;
  /** Set while a scan is in flight, including during the debounce. */
  searching: boolean;
  /** True when the last scan was rejected, in practice a bad regex. */
  failed: boolean;
  setQuery: (next: string) => void;
  toggleOption: (key: keyof SearchOptions) => void;
  openPanel: () => void;
  closePanel: () => void;
}

/**
 * Owns the vault-wide search overlay: its open state, query, toggles, and the
 * debounced `search_workspace` round-trip. The scan runs on demand rather than
 * against a kept index, so results are current by construction and the file
 * watcher has nothing to invalidate.
 */
export function useWorkspaceSearch(): WorkspaceSearchController {
  const root = useWorkspaceRoot();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [results, setResults] = useState<SearchResults>(EMPTY_SEARCH_RESULTS);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  // Monotonic request id: a slow scan that resolves after a newer one started
  // must not overwrite the newer results.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    requestRef.current += 1;
    const request = requestRef.current;
    if (!root || query.length === 0) {
      setResults(EMPTY_SEARCH_RESULTS);
      setFailed(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchWorkspace(root, query, options)
        .then((next) => {
          if (requestRef.current !== request) return;
          setResults(next);
          setFailed(false);
        })
        .catch(() => {
          if (requestRef.current !== request) return;
          setResults(EMPTY_SEARCH_RESULTS);
          setFailed(true);
        })
        .finally(() => {
          if (requestRef.current === request) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, options, root]);

  // The menu item and palette entry are already workspace-gated; the raw
  // keyboard shortcut is not, so the guard here keeps all three consistent.
  const openPanel = useCallback(() => {
    if (root) setOpen(true);
  }, [root]);
  const closePanel = useCallback(() => setOpen(false), []);
  const toggleOption = useCallback((key: keyof SearchOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return {
    open,
    query,
    options,
    results,
    searching,
    failed,
    setQuery,
    toggleOption,
    openPanel,
    closePanel,
  };
}
