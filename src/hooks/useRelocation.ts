import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useCallback } from "react";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { basename, movedPath } from "@/lib/paths";
import type { FileTab, TabsState, Workspace } from "@/lib/tabs";
import type { Relink, RelinkRequest } from "@/lib/vault";

interface UseRelocationOptions {
  stateRef: RefObject<TabsState>;
  workspaceRef: RefObject<Workspace | null>;
  saveDocument: (id: string) => Promise<boolean>;
  markSelfSave: (path: string) => void;
  reloadFromDisk: (path: string) => Promise<void>;
  refreshIndexes: (root: string, isCurrent: () => boolean) => Promise<void>;
  refreshAfterRename: (path: string, newPath: string, root: string) => Promise<void>;
  refreshAfterMove: (from: string, toDir: string, newPath: string, root: string) => Promise<void>;
  confirmRelink: (request: RelinkRequest) => Promise<boolean>;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * Rename and move with their link rewrite. The backend previews the files it
 * would change; the user confirms, the affected tabs are saved so the rewrite
 * reads their edits and no stale buffer overwrites it, and once it lands the
 * rewritten tabs reload and the index catches up.
 */
export function useRelocation({
  stateRef,
  workspaceRef,
  saveDocument,
  markSelfSave,
  reloadFromDisk,
  refreshIndexes,
  refreshAfterRename,
  refreshAfterMove,
  confirmRelink,
  onWorkspaceNotice,
}: UseRelocationOptions) {
  const confirm = useCallback(
    async (preview: Relink, root: string): Promise<boolean> => {
      if (preview.files.length === 0) return true;
      const affected = new Set(preview.files.map((file) => file.path));
      const dirtyTabs = () =>
        stateRef.current.tabs.filter(
          (tab): tab is FileTab =>
            tab.kind === "file" && tab.file.dirty && affected.has(tab.file.path),
        );
      const unsaved = dirtyTabs().map((tab) => tab.file.path);
      if (!(await confirmRelink({ root, files: preview.files, unsaved }))) return false;
      // The prompt is open for an unbounded time, so save what is dirty now.
      const saved = await Promise.all(dirtyTabs().map((tab) => saveDocument(tab.id)));
      return saved.every(Boolean);
    },
    [confirmRelink, saveDocument, stateRef],
  );

  // Null when the user backs out at the prompt.
  const relocate = useCallback(
    async (command: "rename_path" | "move_path", args: Record<string, string>, root: string) => {
      const preview = await invoke<Relink>(command, { ...args, root, dryRun: true });
      if (!(await confirm(preview, root))) return null;
      return invoke<Relink>(command, { ...args, root, dryRun: false });
    },
    [confirm],
  );

  const settle = useCallback(
    async (done: Relink, from: string, root: string) => {
      for (const file of done.files) markSelfSave(file.path);
      if (done.failed) {
        console.error("Failed to update links:", done.failed.error);
        onWorkspaceNotice(
          { key: "notice.relinkFailed", values: { name: basename(done.failed.path) } },
          { persistent: true },
        );
      }
      // The tabs may not have re-rendered onto their new paths yet.
      const open = new Set(
        stateRef.current.tabs
          .filter((tab): tab is FileTab => tab.kind === "file")
          .map((tab) => movedPath(tab.file.path, from, done.newPath)),
      );
      const reloads = done.files
        .filter((file) => open.has(file.path))
        .map((file) => reloadFromDisk(file.path));
      const isCurrent = () => workspaceRef.current?.root === root;
      await Promise.all([...reloads, refreshIndexes(root, isCurrent)]);
    },
    [markSelfSave, onWorkspaceNotice, refreshIndexes, reloadFromDisk, stateRef, workspaceRef],
  );

  const renamePath = useCallback(
    async (path: string, newName: string): Promise<string | null> => {
      const root = workspaceRef.current?.root;
      if (!root) return null;
      try {
        const done = await relocate("rename_path", { path, newName }, root);
        if (!done) return null;
        await refreshAfterRename(path, done.newPath, root);
        await settle(done, path, root);
        return done.newPath;
      } catch (err) {
        console.error("Failed to rename:", err);
        return null;
      }
    },
    [refreshAfterRename, relocate, settle, workspaceRef],
  );

  const movePath = useCallback(
    async (from: string, toDir: string): Promise<string | null> => {
      const root = workspaceRef.current?.root;
      if (!root) return null;
      try {
        const done = await relocate("move_path", { from, toDir }, root);
        if (!done) return null;
        if (done.newPath === from) return from;
        await refreshAfterMove(from, toDir, done.newPath, root);
        await settle(done, from, root);
        return done.newPath;
      } catch (err) {
        console.error("Failed to move:", err);
        return null;
      }
    },
    [refreshAfterMove, relocate, settle, workspaceRef],
  );

  return { renamePath, movePath };
}
