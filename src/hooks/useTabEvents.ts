import { type RefObject, useEffect } from "react";
import { isImageFile } from "@/lib/imageExtensions";
import { activeFileOf, type TabsState, type Workspace } from "@/lib/tabs";
import { subscribe } from "@/lib/tauriEvent";

const DIRECTORY_REFRESH_DEBOUNCE = 300;
const FILE_RELOAD_DEBOUNCE = 300;

interface UseTabEventsParams {
  stateRef: RefObject<TabsState>;
  workspaceRef: RefObject<Workspace | null>;
  isAutoReloadEnabled: () => boolean;
  isRecentSelfSave: (path: string) => boolean;
  reloadFromDisk: (path: string) => Promise<void>;
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
    // Per path: a burst touching several files (git checkout, sync pull) must reload each one.
    const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

    const unsubscribe = subscribe<string>("file-changed", (event) => {
      if (!isAutoReloadEnabled()) return;
      const changedPath = event.payload;
      clearTimeout(timeouts.get(changedPath));
      const timeout = setTimeout(async () => {
        timeouts.delete(changedPath);
        // Images are never watched and never read as text; ignore defensively.
        if (isImageFile(changedPath)) return;
        const isOpen = stateRef.current.tabs.some((t) => activeFileOf(t)?.path === changedPath);
        if (!isOpen) return;
        // Skip if this file-changed was triggered by our own auto-save.
        if (isRecentSelfSave(changedPath)) return;
        await reloadFromDisk(changedPath);
      }, FILE_RELOAD_DEBOUNCE);
      timeouts.set(changedPath, timeout);
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
