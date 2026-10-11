import { type RefObject, useEffect } from "react";
import { isImageFile } from "@/lib/imageExtensions";
import { fileTabs, type TabsState, type Workspace } from "@/lib/tabs";
import { subscribe } from "@/lib/tauriEvent";

const DIRECTORY_REFRESH_DEBOUNCE = 300;
const FILE_RELOAD_DEBOUNCE = 300;

interface UseTabEventsParams {
  stateRef: RefObject<TabsState>;
  workspaceRef: RefObject<Workspace | null>;
  isAutoReloadEnabled: () => boolean;
  isRecentSelfSave: (path: string) => boolean;
  reloadFromDisk: (tabId: string, path: string) => Promise<void>;
  refreshWorkspace: (root: string) => Promise<void>;
}

/**
 * File-watcher-driven tab and workspace updates: external edits to an open
 * file, and workspace directory changes. Open requests live in
 * `useOpenRequests`.
 */
export function useTabEvents({
  stateRef,
  workspaceRef,
  isAutoReloadEnabled,
  isRecentSelfSave,
  reloadFromDisk,
  refreshWorkspace,
}: UseTabEventsParams): void {
  // Listen for file-changed events (auto-reload). Applies to any open file tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribes once; every dependency is read through a ref or a stable callback
  useEffect(() => {
    // Per tab: a burst reloads every file it touched (git checkout, sync pull), and an event
    // for a path a tab has just left cannot cancel the reload that tab is owed.
    const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
    const tabOn = (path: string) =>
      fileTabs(stateRef.current).find((tab) => tab.file.path === path);

    const unsubscribe = subscribe<string>("file-changed", (event) => {
      if (!isAutoReloadEnabled()) return;
      const changedPath = event.payload;
      // Resolved now: a rename or move inside the debounce takes the tab off this path.
      const tabId = tabOn(changedPath)?.id;
      // A tab still opening is not on the strip yet, so its change waits under the path.
      const key = tabId ?? changedPath;
      clearTimeout(timeouts.get(key));
      const timeout = setTimeout(async () => {
        timeouts.delete(key);
        const reportedFor = fileTabs(stateRef.current).find((tab) => tab.id === tabId);
        const tab = reportedFor ?? tabOn(changedPath);
        if (!tab) return;
        // Images are never watched and never read as text; ignore defensively.
        if (isImageFile(tab.file.path)) return;
        // Skip the echo of our own write, marked under the path the tab had when it was written.
        if (isRecentSelfSave(changedPath) || isRecentSelfSave(tab.file.path)) return;
        await reloadFromDisk(tab.id, tab.file.path);
      }, FILE_RELOAD_DEBOUNCE);
      timeouts.set(key, timeout);
    });

    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  // Listen for directory-changed events: refresh the workspace tree + indexes.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe<string>("directory-changed", (event) => {
      const watchedRoot = event.payload;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(async () => {
        if (workspaceRef.current?.root !== watchedRoot) return;
        await refreshWorkspace(watchedRoot);
      }, DIRECTORY_REFRESH_DEBOUNCE);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };
  }, [refreshWorkspace, workspaceRef]);
}
