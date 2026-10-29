import { type RefObject, useEffect } from "react";
import { isImageFile } from "@/lib/imageExtensions";
import { fileTabs, type TabsState, type Workspace } from "@/lib/tabs";
import { subscribe } from "@/lib/tauriEvent";

const DIRECTORY_REFRESH_DEBOUNCE = 300;
const FILE_RELOAD_DEBOUNCE = 300;

/** A workspace change; `documentsChanged` is false when only the tree's listing changed. */
export interface DirectoryChanged {
  root: string;
  documentsChanged: boolean;
}

interface UseTabEventsParams {
  stateRef: RefObject<TabsState>;
  workspaceRef: RefObject<Workspace | null>;
  isAutoReloadEnabled: () => boolean;
  reloadFromDisk: (tabId: string, path: string) => Promise<void>;
  refreshTree: (root: string) => Promise<void>;
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
  reloadFromDisk,
  refreshTree,
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
        // Read the echo of the app's own write too: only its text tells it from another program's.
        await reloadFromDisk(tab.id, tab.file.path);
      }, FILE_RELOAD_DEBOUNCE);
      timeouts.set(key, timeout);
    });

    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  // Listen for directory-changed events: refresh the workspace tree, and the
  // indexes too when a burst changed any document.
  useEffect(() => {
    // Per root: every window hears every watch, and another workspace's change
    // must not reset the timer this one's refresh is waiting on.
    const pending = new Map<
      string,
      { timeout: ReturnType<typeof setTimeout>; documentsChanged: boolean }
    >();
    const unsubscribe = subscribe<DirectoryChanged>("directory-changed", ({ payload }) => {
      const { root } = payload;
      const earlier = pending.get(root);
      clearTimeout(earlier?.timeout);
      const documentsChanged = payload.documentsChanged || (earlier?.documentsChanged ?? false);
      const timeout = setTimeout(async () => {
        pending.delete(root);
        // Judged when the timer fires: a folder is watched before its tree is in place.
        if (workspaceRef.current?.root !== root) return;
        const refresh = documentsChanged ? refreshWorkspace : refreshTree;
        await refresh(root);
      }, DIRECTORY_REFRESH_DEBOUNCE);
      pending.set(root, { timeout, documentsChanged });
    });
    return () => {
      for (const { timeout } of pending.values()) clearTimeout(timeout);
      unsubscribe();
    };
  }, [refreshTree, refreshWorkspace, workspaceRef]);
}
