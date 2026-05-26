// React hook that owns the sync-config lifecycle for a single workspace.
//
// Components shouldn't talk to the Tauri commands directly — they go
// through this hook, which:
// - lazily loads the stored config when the workspace path changes
// - exposes `save`, `remove`, `setToken`, `clearToken`, `init`, `clone`,
//   `runSync`, `refreshStatus` as imperative actions
// - tracks loading / error state so the form can render busy and
//   surface failures inline
//
// `workspacePath = null` is the "no folder open" case — the hook stays
// idle and returns `config: null` so the Sync tab can show its empty
// state.

import { useCallback, useEffect, useState } from "react";
import {
  clearSyncToken as clearSyncTokenCommand,
  cloneSyncRemote,
  describeSyncError,
  getSyncConfig,
  getSyncStatus,
  initSyncRepo,
  removeSyncConfig,
  runSync as runSyncCommand,
  type StatusReport,
  type SyncResult,
  setSyncConfig,
  setSyncToken,
  type WorkspaceSyncConfig,
} from "@/lib/sync";

export interface UseSyncConfigState {
  /** Current stored config for the workspace, or null if unconfigured. */
  config: WorkspaceSyncConfig | null;
  /** Last status report we successfully fetched. */
  status: StatusReport | null;
  /** True while the initial load is in flight. */
  loading: boolean;
  /** Last error from any command call; cleared on the next success. */
  error: string | null;
  /** True while any imperative action is mid-flight. */
  busy: boolean;
}

export interface UseSyncConfigActions {
  save: (config: WorkspaceSyncConfig) => Promise<void>;
  remove: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  initRepo: (defaultBranch: string | null, remoteUrl: string | null) => Promise<void>;
  cloneRemote: (remoteUrl: string, token: string | null) => Promise<void>;
  runSync: () => Promise<SyncResult>;
  refreshStatus: () => Promise<void>;
}

export type UseSyncConfigReturn = UseSyncConfigState & UseSyncConfigActions;

export function useSyncConfig(workspacePath: string | null): UseSyncConfigReturn {
  const [config, setConfig] = useState<WorkspaceSyncConfig | null>(null);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load whenever the workspace flips to a new path.
  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      setConfig(null);
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getSyncConfig(workspacePath)
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(describeSyncError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  /**
   * Wrap an imperative action with busy/error state management.
   * Centralises the try/catch so individual actions stay one-liners.
   */
  const guarded = useCallback(async <T>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      const msg = describeSyncError(e);
      setError(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(
    async (next: WorkspaceSyncConfig) => {
      await guarded(() => setSyncConfig(next));
      setConfig(next);
    },
    [guarded],
  );

  const remove = useCallback(async () => {
    if (!workspacePath) return;
    await guarded(() => removeSyncConfig(workspacePath));
    setConfig(null);
    setStatus(null);
  }, [guarded, workspacePath]);

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
    },
    [guarded, workspacePath],
  );

  const cloneRemote = useCallback(
    async (remoteUrl: string, token: string | null) => {
      if (!workspacePath) return;
      await guarded(() => cloneSyncRemote(workspacePath, remoteUrl, token));
    },
    [guarded, workspacePath],
  );

  const runSync = useCallback(async (): Promise<SyncResult> => {
    if (!workspacePath) {
      throw new Error("no workspace open");
    }
    const result = await guarded(() => runSyncCommand(workspacePath));
    // Refresh status so the UI's "behind/ahead" counters update.
    try {
      const next = await getSyncStatus(workspacePath);
      setStatus(next);
    } catch {
      // status refresh is best-effort; don't override the sync result.
    }
    return result;
  }, [guarded, workspacePath]);

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
  }, [guarded, workspacePath]);

  return {
    config,
    status,
    loading,
    busy,
    error,
    save,
    remove,
    setToken,
    clearToken,
    initRepo,
    cloneRemote,
    runSync,
    refreshStatus,
  };
}
