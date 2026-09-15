import { type Dispatch, type SetStateAction, useCallback } from "react";
import { loadFileContent } from "@/lib/documentContent";
import { EDITOR_MODE } from "@/lib/settings";
import type { TabsState } from "@/lib/tabs";

interface UseDiskReloadOptions {
  setState: Dispatch<SetStateAction<TabsState>>;
  forgetHistory: (id: string) => void;
}

/**
 * Reloads an open tab from disk after a change it did not type: an external
 * edit, or a link rewrite. A tab holding unsaved edits keeps them.
 */
export function useDiskReload({ setState, forgetHistory }: UseDiskReloadOptions) {
  return useCallback(
    async (path: string) => {
      try {
        const { content, metadata } = await loadFileContent(path);
        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((t) => {
            if (t.kind === "graph" || t.file.path !== path) return t;
            // Checked against the latest state, so an edit made while the file
            // was being read is never replaced.
            if (t.file.mode !== EDITOR_MODE.view && t.file.dirty) return t;
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
    [forgetHistory, setState],
  );
}
