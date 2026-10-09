import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { loadFileContent } from "@/lib/documentContent";
import { type TabsState, updateFiles } from "@/lib/tabs";

interface UseDiskReloadOptions {
  setState: Dispatch<SetStateAction<TabsState>>;
  forgetHistory: (id: string) => void;
  selfSaveCount: (path: string) => number;
}

/**
 * Reloads an open tab from disk after a change it did not type: an external
 * edit, or a link rewrite. A tab holding unsaved edits keeps them, and so does
 * a tab edited since `revision` when the caller names one. A read overtaken by
 * the app's own write is repeated, and one overtaken by a later read of the
 * same path is dropped.
 */
export function useDiskReload({ setState, forgetHistory, selfSaveCount }: UseDiskReloadOptions) {
  const started = useRef(0);
  // Per path: the start order of the latest read handed to the tab.
  const delivered = useRef<Map<string, number>>(new Map());

  return useCallback(
    async function reloadFromDisk(path: string, revision?: number): Promise<void> {
      started.current += 1;
      const order = started.current;
      const savesAtStart = selfSaveCount(path);
      try {
        const { content, metadata } = await loadFileContent(path);
        // A write landed mid-read, so this text may predate it or follow a later one: read again.
        if (selfSaveCount(path) !== savesAtStart) return reloadFromDisk(path, revision);
        // Reads resolve in any order; an earlier one never replaces a later one.
        if ((delivered.current.get(path) ?? 0) > order) return;
        delivered.current.set(path, order);
        setState((prev) =>
          updateFiles(prev, ({ id, file }) => {
            if (file.path !== path) return file;
            // Checked against the latest state, so an edit made while the file
            // was being read is never replaced.
            if (file.dirty) return file;
            if (revision !== undefined && file.revision !== revision) return file;
            // The watcher's echo of the app's own write: the tab already holds this text.
            if (file.content === content) return file;
            // Replaying old diffs against changed content is unsafe.
            forgetHistory(id);
            // Edit/split panes render `editContent ?? content`, so a seeded
            // buffer would shadow the reload.
            return {
              ...file,
              content,
              metadata,
              ...(file.editContent != null ? { editContent: content } : {}),
            };
          }),
        );
      } catch {
        // ignore reload errors
      }
    },
    [forgetHistory, selfSaveCount, setState],
  );
}
