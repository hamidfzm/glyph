import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useCallback, useRef } from "react";
import { emptyHistory, popRedo, popUndo, pushEntry, type TabHistory } from "@/lib/editHistory";
import { EDITOR_MODE } from "@/lib/settings";
import { activeFileOf, type FileState, type TabsState } from "@/lib/tabs";
import { toggleTaskAtLine } from "@/lib/taskList";

interface UseDocumentEditsOptions {
  stateRef: RefObject<TabsState>;
  updateActiveFile: (id: string, mutator: (f: FileState) => FileState) => void;
  markSelfSave: (path: string) => void;
}

/**
 * Programmatic (non-typed) document edits — checklist toggles and canvas
 * commits — with a per-tab undo/redo stack. The text editor keeps its own
 * history for typed input.
 */
export function useDocumentEdits({
  stateRef,
  updateActiveFile,
  markSelfSave,
}: UseDocumentEditsOptions) {
  const editHistory = useRef<Map<string, TabHistory>>(new Map());

  /** Drop a tab's undo stack (tab closed, file deleted, or externally reloaded). */
  const forgetHistory = useCallback((id: string) => {
    editHistory.current.delete(id);
  }, []);

  // Apply a programmatic edit. In view mode writes straight to disk (with the
  // self-save grace so the file-watcher doesn't re-enter); in edit/split mode
  // it updates editContent so auto-save flushes it.
  const applyProgrammaticEdit = useCallback(
    async (id: string, next: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
      /* v8 ignore start -- defensive: every caller narrows the tab and its file
         first, and closing a tab forgets its history, so undo/redo cannot arrive
         with a stale id */
      if (!tab) return false;
      const file = activeFileOf(tab);
      if (!file) return false;
      /* v8 ignore stop */

      if (file.mode !== EDITOR_MODE.view) {
        updateActiveFile(id, (f) => ({
          ...f,
          editContent: next,
          dirty: true,
          revision: f.revision + 1,
        }));
        return true;
      }

      try {
        await invoke("write_file", { path: file.path, content: next });
        markSelfSave(file.path);
        // A leftover editContent from an earlier edit-mode session would
        // shadow the fresh content for consumers that render
        // `editContent ?? content` (the canvas viewer), so keep it in sync.
        updateActiveFile(id, (f) => ({
          ...f,
          content: next,
          ...(f.editContent != null ? { editContent: next } : {}),
        }));
        return true;
      } catch (err) {
        console.error("Failed to apply edit:", err);
        return false;
      }
    },
    [markSelfSave, stateRef, updateActiveFile],
  );

  // Toggle a checklist item by source line number. Pushes the change onto the
  // tab's history stack so it can be undone.
  const toggleTask = useCallback(
    async (id: string, line: number) => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const file = activeFileOf(tab);
      if (!file?.content) return;

      const isEditing = file.mode !== EDITOR_MODE.view;
      const source = isEditing ? (file.editContent ?? file.content) : file.content;
      const next = toggleTaskAtLine(source, line);
      if (next === source) return;

      const applied = await applyProgrammaticEdit(id, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before: source, after: next }));
      }
    },
    [applyProgrammaticEdit, stateRef],
  );

  // Commit a finished document edit produced by a non-text editor (e.g. the
  // canvas board): apply it and push one undo entry, exactly like toggleTask.
  // `next` is the full new content; a no-op (unchanged content) is ignored.
  const commitEdit = useCallback(
    async (id: string, next: string) => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const file = activeFileOf(tab);
      if (!file) return;
      /* v8 ignore start -- defensive: every open file has content loaded, so the null fallback is unreachable */
      const disk = file.content ?? "";
      /* v8 ignore stop */
      const before = file.mode !== EDITOR_MODE.view ? (file.editContent ?? disk) : disk;
      if (next === before) return;
      const applied = await applyProgrammaticEdit(id, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before, after: next }));
      }
    },
    [applyProgrammaticEdit, stateRef],
  );

  const undoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popUndo(history);
      if (!result) return;
      const applied = await applyProgrammaticEdit(id, result.entry.before);
      if (applied) editHistory.current.set(id, result.next);
    },
    [applyProgrammaticEdit],
  );

  const redoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popRedo(history);
      if (!result) return;
      const applied = await applyProgrammaticEdit(id, result.entry.after);
      if (applied) editHistory.current.set(id, result.next);
    },
    [applyProgrammaticEdit],
  );

  return { toggleTask, commitEdit, undoEdit, redoEdit, forgetHistory };
}
