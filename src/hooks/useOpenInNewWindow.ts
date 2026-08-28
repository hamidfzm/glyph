import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { captureException } from "@/lib/telemetry";

/**
 * Open a note in its own OS window.
 *
 * A note open in this window **moves** rather than being shown twice: Glyph has
 * no shared document model, so two windows over one path would each hold their
 * own edit buffer and autosave chain, and the later write would silently
 * discard the other window's edits. The source tab is closed first, through the
 * normal close path, so its pending edits are flushed and a cancelled
 * unsaved-changes prompt aborts the whole action rather than leaving the note
 * open in two places.
 *
 * A note open in some *other* window is handled in the backend, which focuses
 * that window instead of spawning a second one.
 */
export function useOpenInNewWindow() {
  const { tabs, closeTabs, openFile } = useTabsContext();

  return useCallback(
    async (path: string) => {
      const open = tabs.find((tab) => tab.kind === "file" && tab.file.path === path);
      if (open && !(await closeTabs([open.id]))) return;
      try {
        await invoke("open_in_new_window", { path });
      } catch (err) {
        // The backend refuses paths outside the session's grants. Every UI
        // entry point offers this only for granted paths, so a rejection means
        // the grant state moved underneath us. The close above already flushed,
        // so reopening here restores the tab rather than leaving the note in no
        // window at all.
        console.error(`Failed to open ${path} in a new window:`, err);
        captureException(err);
        if (open) await openFile(path);
      }
    },
    [tabs, closeTabs, openFile],
  );
}
