import { type RefObject, useCallback, useRef } from "react";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { dailyNotePath, dailyNotesProblem } from "@/lib/dailyNotes";
import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import type { Workspace } from "@/lib/tabs";
import { createDailyNote, getDailyNotesSettings } from "@/lib/workspace";

interface UseDailyNoteOptions {
  workspaceRef: RefObject<Workspace | null>;
  openFile: (path: string) => Promise<string | undefined>;
  setTabMode: (id: string, mode: EditorMode) => void;
  refreshLoadedDirs: (root: string) => Promise<void>;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/** "Open Today's Note": create today's file from the workspace's daily-notes settings when it is missing, then open it. */
export function useDailyNote({
  workspaceRef,
  openFile,
  setTabMode,
  refreshLoadedDirs,
  onWorkspaceNotice,
}: UseDailyNoteOptions) {
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;
  // A repeat while one request is in flight would only race it to the same file.
  const pendingRef = useRef(false);

  const openDailyNote = useCallback(async () => {
    const root = workspaceRef.current?.root;
    if (!root || pendingRef.current) return;
    pendingRef.current = true;
    try {
      const settings = await getDailyNotesSettings(root);
      const today = new Date();
      const problem = dailyNotesProblem(settings, today);
      if (problem) {
        onWorkspaceNoticeRef.current({ key: `dailyNote.${problem}` });
        return;
      }
      const note = await createDailyNote(
        root,
        dailyNotePath(settings, today),
        settings.template ?? null,
      );
      if (note.created) await refreshLoadedDirs(root);
      // The workspace was closed or replaced meanwhile: not this window's note to open.
      if (workspaceRef.current?.root !== root) return;
      const tabId = await openFile(note.path);
      // A new note has nothing to read yet, so it opens ready to write in.
      if (note.created && tabId) setTabMode(tabId, EDITOR_MODE.edit);
    } catch (err) {
      onWorkspaceNoticeRef.current({ key: "dailyNote.failed", values: { error: String(err) } });
    } finally {
      pendingRef.current = false;
    }
  }, [openFile, refreshLoadedDirs, setTabMode, workspaceRef]);

  return { openDailyNote };
}
