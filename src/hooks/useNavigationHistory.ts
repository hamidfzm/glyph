import { useCallback, useEffect, useRef } from "react";
import type { OpenFileOptions } from "@/hooks/useOpenDocument";
import {
  emptyHistory,
  locationOf,
  type NavigationHistory,
  pushLocation,
  repointPaths,
  sameTab,
  stepBack,
  stepForward,
} from "@/lib/navigationHistory";
import { onActiveHeadingChange, scrollDocumentTo, scrollToHeading } from "@/lib/scrollToHeading";
import type { Tab } from "@/lib/tabs";

interface UseNavigationHistoryOptions {
  activeTab: Tab | null;
  /** Session restore activates every persisted tab; those are not navigation. */
  initializing: boolean;
  /** A different workspace is a different set of places; the history resets. */
  workspaceRoot: string | null;
  openFile: (path: string, options?: OpenFileOptions) => Promise<string | undefined>;
  openGraph: (root: string) => void;
  getScrollPosition: (tabId: string) => number | undefined;
}

/**
 * Back/forward history over tab activations and in-document heading jumps.
 * Moves are recorded by where they land, so a Back that activates a tab or
 * scrolls to a heading lands on the entry it just moved to and records nothing.
 */
export function useNavigationHistory({
  activeTab,
  initializing,
  workspaceRoot,
  openFile,
  openGraph,
  getScrollPosition,
}: UseNavigationHistoryOptions) {
  // Nothing renders from the history, so a ref is its only home.
  const historyRef = useRef<NavigationHistory>(emptyHistory());
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  // Reopening a closed file is async; a second move before it lands would
  // record the late arrival as a fresh place, so moves wait their turn.
  const moveInFlightRef = useRef(false);
  const recordedRootRef = useRef(workspaceRoot);

  const activeLocation = activeTab ? locationOf(activeTab) : null;
  const activeKind = activeLocation?.kind;
  const activePath = activeLocation?.path;
  useEffect(() => {
    if (recordedRootRef.current !== workspaceRoot) {
      recordedRootRef.current = workspaceRoot;
      historyRef.current = emptyHistory();
    }
    if (initializing || !activeKind || !activePath) return;
    const location = { kind: activeKind, path: activePath };
    // Arriving on the tab the current entry already names (a Back/Forward, or a
    // heading entry of this tab) is not a new place.
    const current = historyRef.current.entries[historyRef.current.index];
    if (current && sameTab(current, location)) return;
    historyRef.current = pushLocation(historyRef.current, location);
  }, [activeKind, activePath, initializing, workspaceRoot]);

  useEffect(
    () =>
      onActiveHeadingChange((heading) => {
        const tab = activeTabRef.current;
        const location = tab ? locationOf(tab) : null;
        if (!tab || !location || location.kind !== "file") return;
        const leftAt = getScrollPosition(tab.id) ?? 0;
        historyRef.current = pushLocation(historyRef.current, { ...location, heading }, leftAt);
      }),
    [getScrollPosition],
  );

  // `useTabs` calls this as it re-points the open tabs after a rename or move,
  // before the activation effect can mistake the new path for a new place.
  const repointHistory = useCallback((oldPath: string, newPath: string) => {
    historyRef.current = repointPaths(historyRef.current, oldPath, newPath);
  }, []);

  const currentScroll = useCallback(() => {
    const tab = activeTabRef.current;
    return tab ? (getScrollPosition(tab.id) ?? 0) : 0;
  }, [getScrollPosition]);

  const navigate = useCallback(
    (next: NavigationHistory) => {
      const previous = historyRef.current;
      historyRef.current = next;
      const entry = next.entries[next.index];
      const tab = activeTabRef.current;
      const here = tab ? locationOf(tab) : null;
      if (here && sameTab(here, entry)) {
        if (entry.heading) scrollToHeading(entry.heading);
        else scrollDocumentTo(entry.scrollTop);
        return;
      }
      if (entry.kind === "graph") {
        openGraph(entry.path);
        return;
      }
      moveInFlightRef.current = true;
      void openFile(entry.path, { implicit: true })
        .then((opened) => {
          // The file lives in another window now, so this move never landed;
          // rewind, or the next Back would skip the entry we stopped on.
          if (!opened) historyRef.current = previous;
        })
        .finally(() => {
          moveInFlightRef.current = false;
        });
    },
    [openFile, openGraph],
  );

  const navigateBack = useCallback(() => {
    if (moveInFlightRef.current) return;
    const next = stepBack(historyRef.current, currentScroll());
    if (next) navigate(next);
  }, [currentScroll, navigate]);

  const navigateForward = useCallback(() => {
    if (moveInFlightRef.current) return;
    const next = stepForward(historyRef.current, currentScroll());
    if (next) navigate(next);
  }, [currentScroll, navigate]);

  return { navigateBack, navigateForward, repointHistory };
}
