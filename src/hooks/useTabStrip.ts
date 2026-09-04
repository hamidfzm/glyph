import { useCallback, useRef, useState } from "react";
import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import {
  activeFileOf,
  type FileState,
  reorderTabs,
  type Tab,
  type TabsState,
  tabPathOf,
} from "@/lib/tabs";

/**
 * The tab strip itself: which tabs exist, which one is active, their order, and
 * the per-tab view state (mode, edit buffer, scroll position). Document I/O
 * and the workspace tree live in their own hooks.
 */
export function useTabStrip() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const scrollRefs = useRef<Map<string, number>>(new Map());

  const { tabs, activeTabId } = state;
  const activeTab: Tab | null = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);

  // Switching tabs goes through here so the outgoing tab's live scroll lands in
  // its file state before the viewer swaps; the viewer restores it on return.
  const withActiveTab = useCallback((prev: TabsState, id: string): TabsState => {
    if (prev.activeTabId === id) return prev;
    if (!prev.activeTabId) return { ...prev, activeTabId: id };
    // No live memory (a restored tab that was never scrolled) keeps the
    // position already in its state instead of being wiped to 0.
    const savedScroll = scrollRefs.current.get(prev.activeTabId);
    if (savedScroll === undefined) return { ...prev, activeTabId: id };
    return {
      tabs: prev.tabs.map((t) => {
        if (t.id !== prev.activeTabId || t.kind === "graph") return t;
        return { ...t, file: { ...t.file, scrollTop: savedScroll } };
      }),
      activeTabId: id,
    };
  }, []);

  const setActiveTab = useCallback(
    (id: string) => {
      setState((prev) => withActiveTab(prev, id));
    },
    [withActiveTab],
  );

  /** Activate the tab whose primary path matches; a no-op when none does. */
  const activateTabByPath = useCallback(
    (path: string) => {
      setState((prev) => {
        const match = prev.tabs.find((t) => tabPathOf(t) === path);
        return match ? withActiveTab(prev, match.id) : prev;
      });
    },
    [withActiveTab],
  );

  // Reorder the tab strip: move tab `id` to `toIndex` (clamped to the strip).
  // Only the array order changes; the active tab and every tab's state are
  // untouched, and persistence follows from reading the array order.
  const moveTab = useCallback((id: string, toIndex: number) => {
    setState((prev) => reorderTabs(prev, id, toIndex));
  }, []);

  // Move the active tab by `delta` positions (-1 left, +1 right); a no-op at
  // either end of the strip or with no active tab.
  const moveActiveTab = useCallback(
    (delta: number) => {
      const current = stateRef.current;
      if (!current.activeTabId) return;
      const from = current.tabs.findIndex((t) => t.id === current.activeTabId);
      /* v8 ignore start -- defensive: a non-null activeTabId always references an open tab */
      if (from === -1) return;
      /* v8 ignore stop */
      moveTab(current.activeTabId, from + delta);
    },
    [moveTab],
  );

  // A mutator that hands back the file it was given means nothing changed, so
  // the state object is returned untouched and React bails out of the render.
  // That keeps a no-op edit from churning identities (and rescheduling
  // autosave) on every keystroke round-trip through the editor.
  const updateActiveFile = useCallback((id: string, mutator: (f: FileState) => FileState) => {
    setState((prev) => {
      let changed = false;
      const tabs = prev.tabs.map((t) => {
        if (t.id !== id || t.kind === "graph") return t;
        const file = mutator(t.file);
        if (file === t.file) return t;
        changed = true;
        return { ...t, file };
      });
      return changed ? { ...prev, tabs } : prev;
    });
  }, []);

  const setTabMode = useCallback(
    (id: string, mode: EditorMode) => {
      updateActiveFile(id, (f) => {
        // When entering edit mode, initialize editContent from content
        if (mode !== EDITOR_MODE.view && f.editContent === null) {
          return { ...f, mode, editContent: f.content };
        }
        return { ...f, mode };
      });
    },
    [updateActiveFile],
  );

  const updateEditContent = useCallback(
    (id: string, editContent: string) => {
      updateActiveFile(id, (f) => {
        if (f.editContent === editContent) return f;
        return {
          ...f,
          editContent,
          // A virtual buffer has no disk copy, so its edits are its content;
          // without this the view/preview pane would render an empty document.
          ...(f.virtual ? { content: editContent } : {}),
          dirty: true,
          revision: f.revision + 1,
        };
      });
    },
    [updateActiveFile],
  );

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      if (activeTabId) {
        scrollRefs.current.set(activeTabId, scrollTop);
      }
    },
    [activeTabId],
  );

  const getScrollPosition = useCallback((id: string) => scrollRefs.current.get(id), []);

  const forgetScroll = useCallback((id: string) => {
    scrollRefs.current.delete(id);
  }, []);

  return {
    setState,
    stateRef,
    tabs,
    activeTab,
    activeTabId,
    activeFile,
    setActiveTab,
    activateTabByPath,
    withActiveTab,
    moveTab,
    moveActiveTab,
    updateActiveFile,
    setTabMode,
    updateEditContent,
    saveScrollPosition,
    getScrollPosition,
    forgetScroll,
  };
}
