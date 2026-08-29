import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import { loadFileContent } from "@/lib/documentContent";
import { isImageFile } from "@/lib/imageExtensions";
import { EDITOR_MODE } from "@/lib/settings";
import { activeFileOf, type TabsState, type Workspace } from "@/lib/tabs";
import { subscribe } from "@/lib/tauriEvent";

const DIRECTORY_REFRESH_DEBOUNCE = 300;
const FILE_RELOAD_DEBOUNCE = 300;

interface UseTabEventsParams {
  stateRef: RefObject<TabsState>;
  setState: Dispatch<SetStateAction<TabsState>>;
  workspaceRef: RefObject<Workspace | null>;
  openFile: (path: string) => Promise<unknown>;
  openFolder: (root?: string) => Promise<void>;
  isAutoReloadEnabled: () => boolean;
  isRecentSelfSave: (path: string) => boolean;
  forgetHistory: (id: string) => void;
  refreshWorkspace: (root: string) => Promise<void>;
}

/**
 * Backend-driven tab and workspace updates: open requests (drag-drop, file
 * associations, a second instance), external file edits picked up by the file
 * watcher, and workspace directory changes.
 */
export function useTabEvents({
  stateRef,
  setState,
  workspaceRef,
  openFile,
  openFolder,
  isAutoReloadEnabled,
  isRecentSelfSave,
  forgetHistory,
  refreshWorkspace,
}: UseTabEventsParams): void {
  // Listen for open-file and open-folder events (drag-drop, file associations)
  useEffect(() => {
    const unsubscribeFile = subscribe<string>("open-file", (event) => {
      openFile(event.payload);
    });
    const unsubscribeFolder = subscribe<string>("open-folder", (event) => {
      openFolder(event.payload);
    });
    return () => {
      unsubscribeFile();
      unsubscribeFolder();
    };
  }, [openFile, openFolder]);

  // Listen for file-changed events (auto-reload). Applies to any open file tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribes once; every dependency is read through a ref or a stable callback
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unsubscribe = subscribe<string>("file-changed", (event) => {
      if (!isAutoReloadEnabled()) return;
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const changedPath = event.payload;
        // Images are never watched and never read as text; ignore defensively.
        if (isImageFile(changedPath)) return;
        const file = stateRef.current.tabs
          .map((t) => activeFileOf(t))
          .find((candidate) => candidate?.path === changedPath);
        if (!file) return;
        // Skip reload if the file is in edit mode with unsaved changes
        if (file.mode !== EDITOR_MODE.view && file.dirty) return;
        // Skip if this file-changed was triggered by our own auto-save.
        if (isRecentSelfSave(changedPath)) return;
        try {
          const { content, metadata } = await loadFileContent(changedPath);
          setState((prev) => ({
            ...prev,
            tabs: prev.tabs.map((t) => {
              if (t.kind === "graph" || t.file.path !== changedPath) return t;
              // External reload invalidates our edit history — replaying old
              // diffs against changed content is unsafe.
              forgetHistory(t.id);
              return { ...t, file: { ...t.file, content, metadata } };
            }),
          }));
        } catch {
          // ignore reload errors
        }
      }, FILE_RELOAD_DEBOUNCE);
    });

    return () => {
      clearTimeout(timeout);
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
