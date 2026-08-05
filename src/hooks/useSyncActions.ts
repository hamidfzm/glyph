import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { StatusReport, SyncResult, WorkspaceSyncConfig } from "@/lib/sync";
import {
  clearSyncToken as clearSyncTokenCommand,
  cloneSyncRemote,
  commitSyncConfig,
  getSyncStatus,
  initSyncRepo,
  isSyncRepoPresent,
  removeSyncConfig,
  runSync as runSyncCommand,
  setSyncConfig,
  setSyncOrigin,
  setSyncToken,
} from "@/lib/syncCommands";

interface UseSyncActionsOptions {
  workspacePath: string | null;
  /** Wraps each command in the hook's busy/error state. */
  guarded: <T>(action: () => Promise<T>) => Promise<T>;
  setConfig: Dispatch<SetStateAction<WorkspaceSyncConfig | null>>;
  setStatus: Dispatch<SetStateAction<StatusReport | null>>;
  setRepoPresent: Dispatch<SetStateAction<boolean | null>>;
}

/**
 * The imperative half of `useSyncConfig`: one thin wrapper per Tauri sync
 * command, each a no-op without an open workspace, plus the follow-up probes
 * that keep the modal's repo-present and ahead/behind readouts current.
 */
export function useSyncActions({
  workspacePath,
  guarded,
  setConfig,
  setStatus,
  setRepoPresent,
}: UseSyncActionsOptions) {
  const save = useCallback(
    async (next: WorkspaceSyncConfig) => {
      await guarded(() => setSyncConfig(next));
      setConfig(next);
    },
    [guarded, setConfig],
  );

  const remove = useCallback(async () => {
    if (!workspacePath) return;
    await guarded(() => removeSyncConfig(workspacePath));
    setConfig(null);
    setStatus(null);
  }, [guarded, workspacePath, setConfig, setStatus]);

  const setToken = useCallback(
    async (token: string) => {
      if (!workspacePath) return;
      await guarded(() => setSyncToken(workspacePath, token));
    },
    [guarded, workspacePath],
  );

  const clearToken = useCallback(async () => {
    if (!workspacePath) return;
    await guarded(() => clearSyncTokenCommand(workspacePath));
  }, [guarded, workspacePath]);

  const initRepo = useCallback(
    async (defaultBranch: string | null, remoteUrl: string | null) => {
      if (!workspacePath) return;
      await guarded(() => initSyncRepo(workspacePath, defaultBranch, remoteUrl));
      // Re-probe so the modal flips out of the "needs init" state once
      // the underlying `.git` directory exists.
      try {
        const present = await isSyncRepoPresent(workspacePath);
        setRepoPresent(present);
      } catch {
        // best-effort: leave the previous value in place
      }
    },
    [guarded, workspacePath, setRepoPresent],
  );

  const cloneRemote = useCallback(
    async (remoteUrl: string, token: string | null) => {
      if (!workspacePath) return;
      await guarded(() => cloneSyncRemote(workspacePath, remoteUrl, token));
    },
    [guarded, workspacePath],
  );

  const setOrigin = useCallback(
    async (remoteUrl: string) => {
      if (!workspacePath) return;
      await guarded(() => setSyncOrigin(workspacePath, remoteUrl));
    },
    [guarded, workspacePath],
  );

  const commitConfig = useCallback(async (): Promise<boolean> => {
    if (!workspacePath) return false;
    return guarded(() => commitSyncConfig(workspacePath));
  }, [guarded, workspacePath]);

  const runSync = useCallback(
    async (message?: string | null): Promise<SyncResult> => {
      if (!workspacePath) {
        throw new Error("no workspace open");
      }
      const result = await guarded(() => runSyncCommand(workspacePath, message));
      // Refresh status so the UI's "behind/ahead" counters update.
      try {
        const next = await getSyncStatus(workspacePath);
        setStatus(next);
      } catch {
        // status refresh is best-effort; don't override the sync result.
      }
      return result;
    },
    [guarded, workspacePath, setStatus],
  );

  const refreshStatus = useCallback(async () => {
    if (!workspacePath) {
      setStatus(null);
      return;
    }
    try {
      const next = await guarded(() => getSyncStatus(workspacePath));
      setStatus(next);
    } catch {
      // error already captured by guarded()
    }
  }, [guarded, workspacePath, setStatus]);

  const refreshRepoPresent = useCallback(async () => {
    if (!workspacePath) {
      setRepoPresent(null);
      return;
    }
    try {
      const present = await isSyncRepoPresent(workspacePath);
      setRepoPresent(present);
    } catch {
      // best-effort: keep the previous value
    }
  }, [workspacePath, setRepoPresent]);

  return {
    save,
    remove,
    setToken,
    clearToken,
    initRepo,
    cloneRemote,
    setOrigin,
    commitConfig,
    runSync,
    refreshStatus,
    refreshRepoPresent,
  };
}
