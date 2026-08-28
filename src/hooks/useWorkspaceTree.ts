import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { useWorkspaceEntries } from "@/hooks/useWorkspaceEntries";
import { isPathInside } from "@/lib/paths";
import type { DirEntry, Workspace } from "@/lib/tabs";

// Safety bound on the "expand all" walk so a pathological tree can't spin forever.
const EXPAND_ALL_MAX_DIRS = 5000;

interface UseWorkspaceTreeOptions {
  /** Re-point open tabs (and their watchers) after a rename or move. */
  repointOpenFiles: (oldPath: string, newPath: string) => void;
}

/**
 * The window's folder workspace tree: cached directory listings and the
 * expanded set. Entry mutations come from `useWorkspaceEntries`; the tab strip
 * lives in `useTabStrip`.
 */
export function useWorkspaceTree({ repointOpenFiles }: UseWorkspaceTreeOptions) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const loadDirectory = useCallback(async (path: string): Promise<DirEntry[]> => {
    try {
      return await invoke<DirEntry[]>("read_directory", { path });
    } catch (err) {
      console.error(`Failed to read directory ${path}:`, err);
      return [];
    }
  }, []);

  /** Adopt `root` as the workspace, pre-loading the root and every expanded subdir. */
  const openTree = useCallback(
    async (root: string, expandedPaths: string[] = []) => {
      const expanded = new Set(expandedPaths);
      const nodes = new Map<string, DirEntry[]>();
      nodes.set(root, await loadDirectory(root));
      for (const dir of expanded) {
        nodes.set(dir, await loadDirectory(dir));
      }
      const ws: Workspace = { root, expanded, nodes };
      workspaceRef.current = ws;
      setWorkspace(ws);
    },
    [loadDirectory],
  );

  const clearTree = useCallback(() => {
    workspaceRef.current = null;
    setWorkspace(null);
  }, []);

  /** Re-read the root and every already-loaded subdirectory under it. */
  const refreshLoadedDirs = useCallback(
    async (root: string) => {
      const ws = workspaceRef.current;
      if (!ws || ws.root !== root) return;
      const dirsToRefresh = [ws.root];
      for (const dir of ws.nodes.keys()) {
        if (dir !== ws.root && isPathInside(dir, ws.root)) {
          dirsToRefresh.push(dir);
        }
      }
      const fresh = await Promise.all(
        dirsToRefresh.map(async (d) => [d, await loadDirectory(d)] as const),
      );
      setWorkspace((prev) => {
        if (!prev || prev.root !== root) return prev;
        const nodes = new Map(prev.nodes);
        for (const [d, entries] of fresh) {
          nodes.set(d, entries);
        }
        return { ...prev, nodes };
      });
    },
    [loadDirectory],
  );

  const toggleExpand = useCallback(
    async (path: string) => {
      const ws = workspaceRef.current;
      if (!ws) return;

      const wasExpanded = ws.expanded.has(path);
      const newExpanded = new Set(ws.expanded);
      if (wasExpanded) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }

      let newNodes = ws.nodes;
      if (!wasExpanded && !ws.nodes.has(path)) {
        const entries = await loadDirectory(path);
        newNodes = new Map(ws.nodes);
        newNodes.set(path, entries);
      }

      setWorkspace((prev) => (prev ? { ...prev, expanded: newExpanded, nodes: newNodes } : prev));
    },
    [loadDirectory],
  );

  // Collapse every expanded directory in the workspace tree.
  const collapseAll = useCallback(() => {
    setWorkspace((prev) => (prev ? { ...prev, expanded: new Set<string>() } : prev));
  }, []);

  // Expand every directory in the workspace, loading any not-yet-read
  // listings. Bounded so a pathological tree can't spin forever.
  const expandAll = useCallback(
    async (limit: number = EXPAND_ALL_MAX_DIRS) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      const nodes = new Map(ws.nodes);
      const expanded = new Set<string>();
      const queue: string[] = [ws.root];
      let visited = 0;
      while (queue.length > 0 && visited < limit) {
        const dir = queue.shift() as string;
        visited += 1;
        let entries = nodes.get(dir);
        if (!entries) {
          entries = await loadDirectory(dir);
          nodes.set(dir, entries);
        }
        for (const entry of entries) {
          if (entry.isDirectory) {
            expanded.add(entry.path);
            queue.push(entry.path);
          }
        }
      }
      setWorkspace((prev) => (prev ? { ...prev, nodes, expanded } : prev));
    },
    [loadDirectory],
  );

  const entries = useWorkspaceEntries({
    workspaceRef,
    setWorkspace,
    loadDirectory,
    repointOpenFiles,
  });

  return {
    workspace,
    workspaceRef,
    openTree,
    clearTree,
    refreshLoadedDirs,
    toggleExpand,
    collapseAll,
    expandAll,
    ...entries,
  };
}
