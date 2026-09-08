import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import { indexIncompleteKey, sameScanStatus } from "@/lib/workspaceScan";

interface UseWorkspaceIndexOptions {
  /** Root of the currently open workspace, or null when none is open. */
  workspaceRoot: string | null;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * The workspace index, owned by Rust and read here as one snapshot per root:
 * the file set, per-note tags and frontmatter, the link graph, and whether a
 * configured cap cut the scan short.
 */
export function useWorkspaceIndex({ workspaceRoot, onWorkspaceNotice }: UseWorkspaceIndexOptions) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(EMPTY_SNAPSHOT);
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;

  const load = useCallback(async (command: string, root: string): Promise<VaultSnapshot> => {
    try {
      return await invoke<VaultSnapshot>(command, { path: root });
    } catch (err) {
      console.error(`Failed to index ${root}:`, err);
      return EMPTY_SNAPSHOT;
    }
  }, []);

  // Keep the previous object identity while the status is unchanged, so the
  // incomplete-index banner effect below doesn't refire on every refresh.
  const apply = useCallback((next: VaultSnapshot) => {
    setSnapshot((prev) =>
      sameScanStatus(prev.status, next.status) ? { ...next, status: prev.status } : next,
    );
  }, []);

  /**
   * Index a freshly opened workspace, rebuilding from disk rather than reading
   * whatever the backend already holds: a watcher only starts once the folder
   * is open, so anything that changed before then is not in an existing index.
   * Returns the file list, which decides which note auto-opens.
   */
  const scanWorkspace = useCallback(
    async (root: string, isCurrent: () => boolean): Promise<string[]> => {
      const next = await load("vault_refresh", root);
      if (!isCurrent()) return next.files;
      apply(next);
      return next.files;
    },
    [apply, load],
  );

  /**
   * Re-read the index after the workspace directory changed. The backend has
   * already applied the change that triggered this, so this reads rather than
   * rebuilds. The workspace can be replaced while the read runs; the index is
   * window-wide, so writing this root's result into another root's workspace
   * would leave the sidebar and palette pointing at files that are not open.
   */
  const refreshIndexes = useCallback(
    async (root: string, isCurrent: () => boolean) => {
      const next = await load("vault_snapshot", root);
      if (!isCurrent()) return;
      apply(next);
    },
    [apply, load],
  );

  const clearIndexes = useCallback(() => {
    setSnapshot(EMPTY_SNAPSHOT);
    if (workspaceRoot) {
      // Nothing else releases the backend's copy, and it holds every note's
      // tags, fields and links for the rest of the session.
      invoke("vault_forget", { path: workspaceRoot }).catch(() => {});
    }
  }, [workspaceRoot]);

  /** Drop the outgoing workspace's scan state so an incoming one's truncation
   *  (even an identical one) notifies afresh. */
  const resetStatus = useCallback(
    () => setSnapshot((prev) => ({ ...prev, status: EMPTY_SNAPSHOT.status })),
    [],
  );

  // Surface a persistent banner when the index is incomplete (#436). The user
  // can dismiss it; the sidebar keeps its own indicator. Keyed on the workspace
  // root plus the reason and limit: a dismissed banner re-shows only when the
  // truncation actually changes, while switching workspaces notifies afresh
  // even for an identical one.
  const { reason, limit } = snapshot.status;
  useEffect(() => {
    if (!reason || !workspaceRoot) return;
    onWorkspaceNoticeRef.current(
      { key: indexIncompleteKey(reason), values: { limit: String(limit ?? 0) } },
      { persistent: true },
    );
  }, [workspaceRoot, reason, limit]);

  return {
    snapshot,
    scanWorkspace,
    refreshIndexes,
    clearIndexes,
    resetStatus,
  };
}
