import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import {
  COMPLETE_INDEX_STATUS,
  COMPLETE_SCAN,
  type FileScan,
  indexIncompleteKey,
  sameScanStatus,
  truncatedScan,
  type WorkspaceIndexStatus,
} from "@/lib/workspaceScan";

interface UseWorkspaceIndexOptions {
  /** Root of the currently open workspace, or null when none is open. */
  workspaceRoot: string | null;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * What the window knows about the open workspace: the list of openable
 * documents, and the note index Rust owns.
 *
 * These are two different sets and both are needed. `files` covers every
 * document a tab can show (markdown, notebooks, canvases, D2), which is what
 * the palette, autocomplete and the auto-open probe mean by "a file here". The
 * snapshot covers the notes the index parses (markdown and canvases), which is
 * what links, tags and the graph are about.
 */
export function useWorkspaceIndex({ workspaceRoot, onWorkspaceNotice }: UseWorkspaceIndexOptions) {
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(EMPTY_SNAPSHOT);
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexStatus>(COMPLETE_INDEX_STATUS);
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;

  // Walks complete out of order, so the newest one wins rather than the last
  // one to return: a burst of directory changes must not leave the window on
  // an older picture of the workspace.
  const latestWalk = useRef(0);
  // A watcher change during the opening walk must not race it: `vault_refresh`
  // replaces whatever the backend holds, so a snapshot built meanwhile would
  // be thrown away and its file never re-read.
  const openingRoot = useRef<string | null>(null);

  const loadFiles = useCallback(async (root: string): Promise<FileScan> => {
    try {
      return await invoke<FileScan>("list_markdown_files", { path: root });
    } catch (err) {
      console.error(`Failed to list the documents in ${root}:`, err);
      return { files: [], status: COMPLETE_SCAN };
    }
  }, []);

  const loadVault = useCallback(async (command: string, root: string): Promise<VaultSnapshot> => {
    try {
      return await invoke<VaultSnapshot>(command, { path: root });
    } catch (err) {
      console.error(`Failed to index ${root}:`, err);
      return EMPTY_SNAPSHOT;
    }
  }, []);

  // Keep the previous status object identity while the values are unchanged,
  // so the incomplete-index banner effect below doesn't refire on every
  // refresh.
  const apply = useCallback((files: FileScan, vault: VaultSnapshot) => {
    setWorkspaceFiles(files.files);
    setSnapshot(vault);
    setIndexStatus((prev) => {
      const next = { files: files.status, vault: vault.status };
      const unchanged =
        sameScanStatus(next.files, prev.files) && sameScanStatus(next.vault, prev.vault);
      return unchanged ? prev : next;
    });
  }, []);

  /**
   * Walk a freshly opened workspace, rebuilding the index from disk rather
   * than reading whatever the backend already holds: a watcher only starts
   * once the folder is open, so anything that changed before then is not in an
   * existing index. Returns the document list, which decides which note
   * auto-opens.
   */
  const scanWorkspace = useCallback(
    async (root: string, isCurrent: () => boolean): Promise<string[]> => {
      const walk = ++latestWalk.current;
      openingRoot.current = root;
      try {
        const [files, vault] = await Promise.all([
          loadFiles(root),
          loadVault("vault_refresh", root),
        ]);
        if (!isCurrent() || walk !== latestWalk.current) return files.files;
        apply(files, vault);
        return files.files;
      } finally {
        if (openingRoot.current === root) openingRoot.current = null;
      }
    },
    [apply, loadFiles, loadVault],
  );

  /**
   * Re-read after the workspace directory changed. The backend has already
   * applied the change that triggered this, so this reads rather than
   * rebuilds. The workspace can be replaced while the read runs; the index is
   * window-wide, so writing this root's result into another root's workspace
   * would leave the sidebar and palette pointing at files that are not open.
   */
  const refreshIndexes = useCallback(
    async (root: string, isCurrent: () => boolean) => {
      if (openingRoot.current === root) return;
      const walk = ++latestWalk.current;
      const [files, vault] = await Promise.all([
        loadFiles(root),
        loadVault("vault_snapshot", root),
      ]);
      if (!isCurrent() || walk !== latestWalk.current) return;
      apply(files, vault);
    },
    [apply, loadFiles, loadVault],
  );

  /** Drop this window's copy and release the backend's. */
  const clearIndexes = useCallback(
    (root?: string | null) => {
      latestWalk.current++;
      setWorkspaceFiles([]);
      setSnapshot(EMPTY_SNAPSHOT);
      setIndexStatus(COMPLETE_INDEX_STATUS);
      const target = root ?? workspaceRoot;
      if (target) {
        // Nothing else releases the backend's copy, and it holds every note's
        // tags, fields and links for the rest of the session.
        invoke("vault_forget", { path: target }).catch(() => {});
      }
    },
    [workspaceRoot],
  );

  /** Drop the outgoing workspace's scan state so an incoming one's truncation
   *  (even an identical one) notifies afresh. */
  const resetStatus = useCallback(() => setIndexStatus(COMPLETE_INDEX_STATUS), []);

  // Surface a persistent banner when the index is incomplete (#436). The user
  // can dismiss it; the sidebar keeps its own indicator. Keyed on the workspace
  // root plus the reason and limit: a dismissed banner re-shows only when the
  // truncation actually changes, while switching workspaces notifies afresh
  // even for an identical one.
  const truncation = truncatedScan(indexStatus);
  const reason = truncation?.reason ?? null;
  const limit = truncation?.limit ?? null;
  useEffect(() => {
    if (!reason || !workspaceRoot) return;
    onWorkspaceNoticeRef.current(
      { key: indexIncompleteKey(reason), values: { limit: String(limit ?? 0) } },
      { persistent: true },
    );
  }, [workspaceRoot, reason, limit]);

  return {
    workspaceFiles,
    snapshot,
    indexStatus,
    scanWorkspace,
    refreshIndexes,
    clearIndexes,
    resetStatus,
  };
}
