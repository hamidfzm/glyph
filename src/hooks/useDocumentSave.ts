import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SetTabsState } from "@/hooks/useTabStrip";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import type { EnqueueWrite } from "@/hooks/useWriteQueue";
import { MARKDOWN_EXTENSIONS } from "@/lib/markdownExtensions";
import { basename, isPathInside } from "@/lib/paths";
import { pickSaveDocument } from "@/lib/pickers";
import type { FileState, FileTab, TabsState } from "@/lib/tabs";
import { setWorkspaceLastFile } from "@/lib/workspace";

interface UseDocumentSaveOptions {
  stateRef: RefObject<TabsState>;
  setState: SetTabsState;
  updateActiveFile: (id: string, mutator: (f: FileState) => FileState) => void;
  addToRecent: (path: string) => void;
  getWorkspaceRoot: () => string | null;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
  markSelfSave: (path: string) => void;
  enqueueWrite: EnqueueWrite;
}

/**
 * Persists dirty document tabs. Writes go through the per-path queue so two
 * writes of the same file can never land out of order, and a virtual
 * (never-saved) buffer is routed through a Save As dialog.
 */
export function useDocumentSave({
  stateRef,
  setState,
  updateActiveFile,
  addToRecent,
  getWorkspaceRoot,
  onWorkspaceNotice,
  markSelfSave,
  enqueueWrite,
}: UseDocumentSaveOptions) {
  const { t } = useTranslation("workspace");
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;

  // Save a virtual buffer to a chosen path (Save As): on success it becomes an
  // ordinary file tab; a cancelled or failed dialog returns false so close can discard.
  const saveVirtualAs = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const pick = (dir?: string) =>
        pickSaveDocument(
          `${title}.md`,
          t("common:fileDialog.markdown"),
          MARKDOWN_EXTENSIONS as string[],
          dir,
        );
      // Default into the open workspace so a new note lands beside its siblings.
      const pickTarget = async () => {
        const startDir = getWorkspaceRoot();
        if (!startDir) return pick();
        try {
          return await pick(startDir);
        } catch (err) {
          // The backend refuses a root it no longer resolves (renamed, or its
          // drive is gone), and the note must stay saveable: ask again, anywhere.
          console.warn("Save As failed, asking again with no starting folder:", err);
          return pick();
        }
      };
      let target: string | null = null;
      let pickFailed = false;
      try {
        target = await pickTarget();
      } catch (err) {
        // The backend can also refuse the chosen name, one the grants will not write.
        console.error("Save As failed:", err);
        pickFailed = true;
      }
      // The dialog does not block the editor, so the buffer is read only now.
      // A tab closed while it was open has nothing left to save.
      const latest = stateRef.current.tabs.find((tab) => tab.id === id);
      if (latest?.kind !== "file") return true;
      if (pickFailed) {
        onWorkspaceNoticeRef.current(
          { key: "notice.saveFailed", values: { name: title } },
          { persistent: true },
        );
        return false;
      }
      if (!target) return false;
      // newDocument seeds the edit buffer with "" and nothing resets it to null.
      /* v8 ignore start -- unreachable: a tab that began virtual always has an edit buffer */
      const content = latest.file.editContent ?? "";
      /* v8 ignore stop */
      const { revision } = latest.file;
      // `openFile` activates the existing tab when a path is already open, so
      // Save As is the only way two tabs could land on one file. Refuse before
      // writing: the open tab may hold unsaved edits, and once the write has
      // happened there is no way to fold the two buffers into one without
      // discarding somebody's work (#721).
      const alreadyOpen = stateRef.current.tabs.some(
        (tab) => tab.kind === "file" && tab.file.path === target,
      );
      if (alreadyOpen) {
        onWorkspaceNoticeRef.current(
          { key: "notice.saveTargetOpen", values: { name: basename(target) } },
          { persistent: true },
        );
        return false;
      }
      try {
        await invoke("write_file", { path: target, content });
      } catch (err) {
        console.error("Failed to save document:", err);
        onWorkspaceNoticeRef.current(
          { key: "notice.saveFailed", values: { name: basename(target) } },
          { persistent: true },
        );
        return false;
      }
      markSelfSave(target);
      // Best-effort: a failed watch never blocks the save.
      invoke("watch_file", { path: target }).catch(() => {});
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) => {
          if (tab.id !== id || tab.kind !== "file") return tab;
          return {
            ...tab,
            file: {
              ...tab.file,
              path: target,
              virtual: false,
              // Stay dirty when a newer edit landed while the write was in flight.
              dirty: tab.file.revision !== revision,
              content,
            },
          };
        }),
      }));
      addToRecent(target);
      const root = getWorkspaceRoot();
      if (root && isPathInside(target, root)) {
        setWorkspaceLastFile(root, target).catch(() => {});
      }
      return true;
    },
    [addToRecent, getWorkspaceRoot, markSelfSave, setState, stateRef, t],
  );

  // Persist one dirty editable tab. Safe to call for any tab id: skips graph,
  // clean, and still-loading tabs. The write is queued per path, and the
  // dirty flag is cleared only when the written revision is still current, so a
  // slow write completing after a newer edit never strands that edit. Resolves
  // false when the write or Save As failed, true otherwise, including when an
  // edit made during the write leaves the tab dirty: `saveUntilClean` checks that.
  const saveDocument = useCallback(
    (id: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
      if (tab?.kind !== "file") return Promise.resolve(true);
      const file = tab.file;
      // A virtual buffer has no disk path yet: route through Save As.
      if (file.virtual) return saveVirtualAs(id, file.path);
      if (!file.dirty) return Promise.resolve(true);
      // editContent is the edit buffer, always set once a tab is dirty; the null
      // check narrows the type for the write below ("" stays valid, since a
      // fully-deleted document must still save, see #432). It reports a failure
      // so `saveUntilClean` can never go round forever on a tab that stays dirty.
      /* v8 ignore start -- unreachable: a dirty tab always has an edit buffer */
      if (file.editContent == null) return Promise.resolve(false);
      /* v8 ignore stop */
      const { path, editContent: content, revision } = file;

      return enqueueWrite(path, async (): Promise<boolean> => {
        try {
          await invoke("write_file", { path, content });
          markSelfSave(path);
          updateActiveFile(id, (f) => ({
            ...f,
            content,
            // Stay dirty when a newer edit landed while this write was in
            // flight, so the newer revision is saved too.
            dirty: f.revision !== revision,
          }));
          return true;
        } catch (err) {
          console.error("Auto-save failed:", err);
          // Leave the tab dirty (it retries on the next edit or shutdown flush)
          // and surface a visible, actionable notice instead of failing silently.
          onWorkspaceNoticeRef.current(
            { key: "notice.saveFailed", values: { name: basename(path) } },
            { persistent: true },
          );
          return false;
        }
      });
    },
    [enqueueWrite, markSelfSave, saveVirtualAs, stateRef, updateActiveFile],
  );

  // Save until none of `dirtyTabs()` is left dirty: an edit made while a write
  // was in flight keeps its tab dirty, and the next round writes it. A tab whose
  // write or Save As fails leaves the rounds, and the failed tabs are returned.
  const saveUntilClean = useCallback(
    async (dirtyTabs: () => FileTab[]): Promise<FileTab[]> => {
      const failed = new Map<string, FileTab>();
      const save = async (tab: FileTab) => {
        if (!(await saveDocument(tab.id))) failed.set(tab.id, tab);
      };
      // Untitled documents open their Save As one after another, so the user can tell them apart.
      const saveRound = async (tabs: FileTab[]) => {
        const saveUntitledInTurn = async () => {
          for (const tab of tabs.filter((tab) => tab.file.virtual)) await save(tab);
        };
        await Promise.all([
          ...tabs.filter((tab) => !tab.file.virtual).map(save),
          saveUntitledInTurn(),
        ]);
      };
      let dirty = dirtyTabs();
      while (dirty.length > 0) {
        await saveRound(dirty);
        dirty = dirtyTabs().filter((tab) => !failed.has(tab.id));
      }
      return [...failed.values()];
    },
    [saveDocument],
  );

  return { saveDocument, saveUntilClean };
}
