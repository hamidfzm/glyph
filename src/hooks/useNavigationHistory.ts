import { useCallback, useEffect, useRef } from "react";
import {
  emptyHistory,
  type NavigationHistory,
  type NavigationLocation,
  pushLocation,
  sameTab,
  stepBack,
  stepForward,
} from "@/lib/navigationHistory";
import { onActiveHeadingChange, scrollDocumentTo, scrollToHeading } from "@/lib/scrollToHeading";
import { type Tab, tabPathOf } from "@/lib/tabs";

interface UseNavigationHistoryOptions {
  activeTab: Tab | null;
  /** Session restore activates every persisted tab; those are not navigation. */
  initializing: boolean;
  openFile: (path: string) => Promise<void>;
  openGraph: () => void;
  getScrollPosition: (tabId: string) => number;
}

// An unsaved buffer has no disk copy to reopen, so it never enters the history.
function locationOf(tab: Tab): NavigationLocation | null {
  if (tab.kind === "file" && tab.file.virtual) return null;
  return { kind: tab.kind, path: tabPathOf(tab) };
}

/**
 * Back/forward history over tab activations and in-document heading jumps.
 * Moves are recorded by where they land, so a Back that activates a tab or
 * scrolls to a heading lands on the entry it just moved to and records nothing.
 */
export function useNavigationHistory({
  activeTab,
  initializing,
  openFile,
  openGraph,
  getScrollPosition,
}: UseNavigationHistoryOptions) {
  // Nothing renders from the history, so a ref is its only home.
  const historyRef = useRef<NavigationHistory>(emptyHistory());
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const activeLocation = activeTab ? locationOf(activeTab) : null;
  const activeKind = activeLocation?.kind;
  const activePath = activeLocation?.path;
  useEffect(() => {
    if (initializing || !activeKind || !activePath) return;
    const location = { kind: activeKind, path: activePath };
    // Arriving on the tab the current entry already names (a Back/Forward, or a
    // heading entry of this tab) is not a new place.
    const current = historyRef.current.entries[historyRef.current.index];
    if (current && sameTab(current, location)) return;
    historyRef.current = pushLocation(historyRef.current, location);
  }, [activeKind, activePath, initializing]);

  useEffect(
    () =>
      onActiveHeadingChange((heading) => {
        const tab = activeTabRef.current;
        const location = tab ? locationOf(tab) : null;
        if (!tab || !location || location.kind !== "file") return;
        const leftAt = getScrollPosition(tab.id);
        historyRef.current = pushLocation(historyRef.current, { ...location, heading }, leftAt);
      }),
    [getScrollPosition],
  );

  const currentScroll = useCallback(() => {
    const tab = activeTabRef.current;
    return tab ? getScrollPosition(tab.id) : 0;
  }, [getScrollPosition]);

  const navigate = useCallback(
    (next: NavigationHistory) => {
      historyRef.current = next;
      const entry = next.entries[next.index];
      const tab = activeTabRef.current;
      const staysOnTab = tab !== null && sameTab({ kind: tab.kind, path: tabPathOf(tab) }, entry);
      if (!staysOnTab) {
        if (entry.kind === "graph") openGraph();
        else void openFile(entry.path);
        return;
      }
      if (entry.heading) scrollToHeading(entry.heading);
      else scrollDocumentTo(entry.scrollTop);
    },
    [openFile, openGraph],
  );

  const navigateBack = useCallback(() => {
    const next = stepBack(historyRef.current, currentScroll());
    if (next) navigate(next);
  }, [currentScroll, navigate]);

  const navigateForward = useCallback(() => {
    const next = stepForward(historyRef.current, currentScroll());
    if (next) navigate(next);
  }, [currentScroll, navigate]);

  return { navigateBack, navigateForward };
}
