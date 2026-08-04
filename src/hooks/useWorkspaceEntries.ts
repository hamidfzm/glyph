import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { lastSegment, parentDir, pruneInside } from "@/lib/paths";
import type { DirEntry, Workspace } from "@/lib/tabs";

interface UseWorkspaceEntriesOptions {
  workspaceRef: RefObject<Workspace | null>;
  setWorkspace: Dispatch<SetStateAction<Workspace | null>>;
  loadDirectory: (path: string) => Promise<DirEntry[]>;
  /** Re-point open tabs (and their watchers) after a rename or move. */
  repointOpenFiles: (oldPath: string, newPath: string) => void;
}

/**
 * Entry mutations on the workspace tree: create, rename, duplicate, move,
 * delete. Each refreshes the affected directory listings so the change shows
 * immediately rather than waiting on the directory watcher's debounce.
 */
export function useWorkspaceEntries({
  workspaceRef,
  setWorkspace,
  loadDirectory,
  repointOpenFiles,
}: UseWorkspaceEntriesOptions) {
  const { t } = useTranslation("workspace");

  // Create a note/canvas/folder inside `dir`, then expand `dir` and refresh
  // its listing. Returns the created path, or null.
  const createEntry = useCallback(
    async (dir: string, kind: "note" | "canvas" | "folder"): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const command =
          kind === "note" ? "create_note" : kind === "canvas" ? "create_canvas" : "create_folder";
        const newPath = await invoke<string>(command, { dir, root: ws.root });
        const entries = await loadDirectory(dir);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(dir, entries);
          const expanded = new Set(prev.expanded);
          if (dir !== prev.root) expanded.add(dir);
          return { ...prev, nodes, expanded };
        });
        return newPath;
      } catch (err) {
        console.error(`Failed to create ${kind}:`, err);
        return null;
      }
    },
    [loadDirectory, setWorkspace, workspaceRef],
  );

  // Rename an entry (inline rename). Returns the final (collision-safe) path.
  const renamePath = useCallback(
    async (path: string, newName: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const finalPath = await invoke<string>("rename_path", { path, newName, root: ws.root });
        const parent = parentDir(path, ws.root);
        const entries = await loadDirectory(parent);
        repointOpenFiles(path, finalPath);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(parent, entries);
          return { ...prev, nodes };
        });
        return finalPath;
      } catch (err) {
        console.error("Failed to rename:", err);
        return null;
      }
    },
    [loadDirectory, repointOpenFiles, setWorkspace, workspaceRef],
  );

  // Duplicate a note/folder next to itself, then refresh the parent listing.
  const duplicatePath = useCallback(
    async (path: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const newPath = await invoke<string>("duplicate_path", { path, root: ws.root });
        const parent = parentDir(path, ws.root);
        const entries = await loadDirectory(parent);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(parent, entries);
          return { ...prev, nodes };
        });
        return newPath;
      } catch (err) {
        console.error("Failed to duplicate:", err);
        return null;
      }
    },
    [loadDirectory, setWorkspace, workspaceRef],
  );

  // Move a note/folder into `toDir`. Refreshes both the source and destination
  // listings, prunes cached child listings under the old location, and
  // re-points open tabs (and their watchers) if they moved.
  const movePath = useCallback(
    async (from: string, toDir: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const newPath = await invoke<string>("move_path", { from, toDir, root: ws.root });
        if (newPath === from) return newPath;
        const sourceParent = parentDir(from, ws.root);
        const [sourceEntries, destEntries] = await Promise.all([
          loadDirectory(sourceParent),
          loadDirectory(toDir),
        ]);
        repointOpenFiles(from, newPath);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(sourceParent, sourceEntries);
          nodes.set(toDir, destEntries);
          pruneInside(nodes.keys(), from, (key) => nodes.delete(key));
          return { ...prev, nodes };
        });
        return newPath;
      } catch (err) {
        console.error("Failed to move:", err);
        return null;
      }
    },
    [loadDirectory, repointOpenFiles, setWorkspace, workspaceRef],
  );

  // Delete a note/folder after confirming, then refresh the parent listing and
  // prune cached listings under it. Open tabs are closed by the caller.
  const deleteEntry = useCallback(
    async (path: string): Promise<boolean> => {
      const ws = workspaceRef.current;
      if (!ws) return false;
      const name = lastSegment(path);
      const confirmed = await ask(t("confirmDelete.message", { name }), {
        title: t("confirmDelete.title"),
        kind: "warning",
      });
      if (!confirmed) return false;
      try {
        await invoke("delete_path", { path, root: ws.root });
      } catch (err) {
        console.error("Failed to delete:", err);
        return false;
      }

      const parent = parentDir(path, ws.root);
      const entries = await loadDirectory(parent);
      setWorkspace((prev) => {
        if (!prev) return prev;
        const nodes = new Map(prev.nodes);
        nodes.set(parent, entries);
        pruneInside(nodes.keys(), path, (key) => nodes.delete(key));
        const expanded = new Set(prev.expanded);
        pruneInside(expanded, path, (key) => expanded.delete(key));
        return { ...prev, nodes, expanded };
      });
      return true;
    },
    [loadDirectory, setWorkspace, t, workspaceRef],
  );

  return { createEntry, renamePath, duplicatePath, movePath, deleteEntry };
}
