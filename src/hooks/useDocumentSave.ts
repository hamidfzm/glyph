import { invoke } from "@tauri-apps/api/core";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { MARKDOWN_EXTENSIONS } from "@/lib/markdownExtensions";
import { basename, isPathInside } from "@/lib/paths";
import { pickSave } from "@/lib/pickers";
import type { FileMetadata, FileState, TabsState } from "@/lib/tabs";
import { setWorkspaceLastFile } from "@/lib/workspace";

interface UseDocumentSaveOptions {
  stateRef: RefObject<TabsState>;
  setState: Dispatch<SetStateAction<TabsState>>;
  updateActiveFile: (id: string, mutator: (f: FileState) => FileState) => void;
  addToRecent: (path: string) => void;
  getWorkspaceRoot: () => string | null;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
  markSelfSave: (path: string) => void;
}

/**
 * Persists dirty document tabs. Writes are serialized per path so two saves of
 * the same file can never land out of order, and a virtual (never-saved) buffer
 * is routed through a Save As dialog.
 */
export function useDocumentSave({
  stateRef,
  setState,
  updateActiveFile,
  addToRecent,
  getWorkspaceRoot,
  onWorkspaceNotice,
  markSelfSave,
}: UseDocumentSaveOptions) {
  const { t } = useTranslation("workspace");
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;

  // Per-path write queue: serializes saves for the same file so two writes
  // can't complete out of order (the newer edit must land last on disk).
  const writeChains = useRef<Map<string, Promise<unknown>>>(new Map());

  // Save a virtual buffer to a chosen path (Save As): on success it becomes an
  // ordinary file tab; a cancelled dialog returns false so close can discard.
  const saveVirtualAs = useCallback(
    async (id: string, file: FileState): Promise<boolean> => {
      // A virtual tab always carries a string edit buffer (newDocument seeds "").
      /* v8 ignore start -- unreachable: editContent is never null for a virtual tab */
      const content = file.editContent ?? "";
      /* v8 ignore stop */
      // Default into the open workspace so a new note lands beside its siblings.
      const target = await pickSave(
        `${file.path}.md`,
        t("common:fileDialog.markdown"),
        MARKDOWN_EXTENSIONS as string[],
        getWorkspaceRoot() ?? undefined,
      );
      if (!target) return false;
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
      // pickSave grants write-only, so watch/metadata may be declined; both are
      // best-effort and never block the save.
      invoke("watch_file", { path: target }).catch(() => {});
      const metadata = await invoke<FileMetadata>("get_file_metadata", { path: target }).catch(
        () => null,
      );
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) => {
          if (tab.id !== id || tab.kind !== "file") return tab;
          return {
            ...tab,
            file: { ...tab.file, path: target, virtual: false, dirty: false, content, metadata },
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
  // clean, and still-loading tabs. The write is serialized per path, and the
  // dirty flag is cleared only when the written revision is still current, so a
  // slow write completing after a newer edit never strands that edit. Resolves
  // true when the document is safely on disk (or there was nothing to save),
  // false when the write failed — the close coordinator reads this directly
  // rather than re-checking dirty state, which may not have re-rendered yet.
  const saveDocument = useCallback(
    (id: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
      if (tab?.kind !== "file") return Promise.resolve(true);
      const file = tab.file;
      // A virtual buffer has no disk path yet: route through Save As.
      if (file.virtual) return saveVirtualAs(id, file);
      if (!file.dirty) return Promise.resolve(true);
      // editContent is the edit buffer, always set once a tab is dirty; the null
      // check only narrows the type for the write below ("" stays valid, since a
      // fully-deleted document must still save, see #432).
      /* v8 ignore start -- unreachable: a dirty tab always has an edit buffer */
      if (file.editContent == null) return Promise.resolve(true);
      /* v8 ignore stop */
      const { path, editContent: content, revision } = file;

      const previous = writeChains.current.get(path) ?? Promise.resolve();
      const run = previous.then(async (): Promise<boolean> => {
        try {
          await invoke("write_file", { path, content });
          markSelfSave(path);
          updateActiveFile(id, (f) => ({
            ...f,
            content,
            // Stay dirty when a newer edit landed while this write was in
            // flight, so the newer revision is saved on its own timer.
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
      // Keep the chain intact even if this write threw, so ordering holds.
      writeChains.current.set(
        path,
        run.catch(() => {}),
      );
      return run;
    },
    [markSelfSave, saveVirtualAs, stateRef, updateActiveFile],
  );

  return { saveDocument };
}
