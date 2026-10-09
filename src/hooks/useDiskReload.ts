import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { loadFileContent } from "@/lib/documentContent";
import { EDITOR_MODE } from "@/lib/settings";
import type { TabsState } from "@/lib/tabs";

interface UseDiskReloadOptions {
  setState: Dispatch<SetStateAction<TabsState>>;
  forgetHistory: (id: string) => void;
  selfSaveCount: (path: string) => number;
}

/**
 * Reloads an open tab from disk after a change it did not type: an external
 * edit, or a link rewrite. A tab holding unsaved edits keeps them, and so does
 * a tab edited since `revision` when the caller names one. A read overtaken by
 * the app's own write, or by a later read of the same path, is dropped.
 */
export function useDiskReload({ setState, forgetHistory, selfSaveCount }: UseDiskReloadOptions) {
  const started = useRef(0);
  // Per path: the start order of the latest read handed to the tab.
  const delivered = useRef<Map<string, number>>(new Map());

  return useCallback(
    async (path: string, revision?: number) => {
      started.current += 1;
      const order = started.current;
      const savesAtStart = selfSaveCount(path);
      try {
        const { content, metadata } = await loadFileContent(path);
        // A save mid-read leaves the tab clean, so nothing below stops the text it replaced.
        if (selfSaveCount(path) !== savesAtStart) return;
        // Reads resolve in any order; an earlier one never replaces a later one.
        if ((delivered.current.get(path) ?? 0) > order) return;
        delivered.current.set(path, order);
        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((t) => {
            if (t.kind === "graph" || t.file.path !== path) return t;
            // Checked against the latest state, so an edit made while the file
            // was being read is never replaced.
            if (t.file.mode !== EDITOR_MODE.view && t.file.dirty) return t;
            if (revision !== undefined && t.file.revision !== revision) return t;
            // Replaying old diffs against changed content is unsafe.
            forgetHistory(t.id);
            // Edit/split panes render `editContent ?? content`, so a seeded
            // buffer would shadow the reload.
            return {
              ...t,
              file: {
                ...t.file,
                content,
                metadata,
                ...(t.file.editContent != null ? { editContent: content } : {}),
              },
            };
          }),
        }));
      } catch {
        // ignore reload errors
      }
    },
    [forgetHistory, selfSaveCount, setState],
  );
}
