import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useCallback, useRef } from "react";
import type { EnqueueWrite } from "@/hooks/useWriteQueue";
import { emptyHistory, popRedo, popUndo, pushEntry, type TabHistory } from "@/lib/editHistory";
import { EDITOR_MODE } from "@/lib/settings";
import { activeFileOf, type FileState, liveContentOf, type TabsState } from "@/lib/tabs";
import { toggleTaskAtLine } from "@/lib/taskList";

interface UseDocumentEditsOptions {
  stateRef: RefObject<TabsState>;
  updateActiveFile: (id: string, mutator: (f: FileState) => FileState) => void;
  markSelfSave: (path: string) => void;
  enqueueWrite: EnqueueWrite;
}

/**
 * Programmatic (non-typed) document edits (checklist toggles and canvas
 * commits) with a per-tab undo/redo stack. The text editor keeps its own
 * history for typed input.
 */
export function useDocumentEdits({
  stateRef,
  updateActiveFile,
  markSelfSave,
  enqueueWrite,
}: UseDocumentEditsOptions) {
  const editHistory = useRef<Map<string, TabHistory>>(new Map());

  /** Drop a tab's undo stack (tab closed, file deleted, or externally reloaded). */
  const forgetHistory = useCallback((id: string) => {
    editHistory.current.delete(id);
  }, []);

  const findFile = useCallback(
    (id: string) => activeFileOf(stateRef.current.tabs.find((candidate) => candidate.id === id)),
    [stateRef],
  );

  // Apply a programmatic edit. A tab in edit/split mode, or one still holding
  // unsaved edits, takes it in the buffer so the save path writes everything
  // together; only a clean view-mode tab writes straight to disk (with the
  // self-save grace so the file-watcher doesn't re-enter).
  const applyProgrammaticEdit = useCallback(
    async (id: string, file: FileState, next: string): Promise<boolean> => {
      if (file.mode !== EDITOR_MODE.view || file.dirty) {
        updateActiveFile(id, (f) => ({
          ...f,
          editContent: next,
          dirty: true,
          revision: f.revision + 1,
        }));
        return true;
      }

      const { path, revision } = file;
      try {
        await enqueueWrite(path, () => invoke("write_file", { path, content: next }));
        markSelfSave(path);
        updateActiveFile(id, (f) => {
          // Text typed while the write was in flight owns the buffer now.
          if (f.revision !== revision) return { ...f, content: next };
          // A buffer left over from an earlier edit session would shadow the
          // fresh content, since every pane renders the live text.
          return {
            ...f,
            content: next,
            ...(f.editContent != null ? { editContent: next } : {}),
          };
        });
        return true;
      } catch (err) {
        console.error("Failed to apply edit:", err);
        return false;
      }
    },
    [enqueueWrite, markSelfSave, updateActiveFile],
  );

  // Toggle a checklist item by source line number. Pushes the change onto the
  // tab's history stack so it can be undone.
  const toggleTask = useCallback(
    async (id: string, line: number) => {
      const file = findFile(id);
      if (!file) return;
      // The line was reported by a pane rendering the live text.
      const source = liveContentOf(file);
      if (source == null) return;
      const next = toggleTaskAtLine(source, line);
      if (next === source) return;

      const applied = await applyProgrammaticEdit(id, file, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before: source, after: next }));
      }
    },
    [applyProgrammaticEdit, findFile],
  );

  // Commit a finished document edit produced by a non-text editor (e.g. the
  // canvas board): apply it and push one undo entry, exactly like toggleTask.
  // `next` is the full new content; a no-op (unchanged content) is ignored.
  const commitEdit = useCallback(
    async (id: string, next: string) => {
      const file = findFile(id);
      if (!file) return;
      /* v8 ignore start -- defensive: every open file has content loaded, so the null fallback is unreachable */
      const before = liveContentOf(file) ?? "";
      /* v8 ignore stop */
      if (next === before) return;
      const applied = await applyProgrammaticEdit(id, file, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before, after: next }));
      }
    },
    [applyProgrammaticEdit, findFile],
  );

  // Step a tab across a history entry. An entry is a whole-document snapshot,
  // so it only applies to the text it was recorded against: if the user has
  // typed since, replaying it would discard that text, so the stack is dropped.
  const replay = useCallback(
    async (id: string, from: string, to: string): Promise<boolean> => {
      const file = findFile(id);
      /* v8 ignore start -- defensive: closing a tab forgets its history, so undo/redo cannot arrive with a stale id */
      if (!file) return false;
      /* v8 ignore stop */
      if (liveContentOf(file) !== from) {
        forgetHistory(id);
        return false;
      }
      return applyProgrammaticEdit(id, file, to);
    },
    [applyProgrammaticEdit, findFile, forgetHistory],
  );

  const undoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popUndo(history);
      if (!result) return;
      const applied = await replay(id, result.entry.after, result.entry.before);
      if (applied) editHistory.current.set(id, result.next);
    },
    [replay],
  );

  const redoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popRedo(history);
      if (!result) return;
      const applied = await replay(id, result.entry.before, result.entry.after);
      if (applied) editHistory.current.set(id, result.next);
    },
    [replay],
  );

  return { toggleTask, commitEdit, undoEdit, redoEdit, forgetHistory };
}
