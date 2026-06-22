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
import { useTranslation } from "react-i18next";
import {
  type CommitAuthorHint,
  clearSyncToken as clearSyncTokenCommand,
  cloneSyncRemote,
  commitSyncConfig,
  describeSyncError,
  getDefaultSyncAuthor,
  getSyncConfig,
  getSyncStatus,
  initSyncRepo,
  isSyncRepoPresent,
  removeSyncConfig,
  runSync as runSyncCommand,
  type StatusReport,
  type SyncResult,
  setSyncConfig,
  setSyncOrigin,
  setSyncToken,
  type WorkspaceSyncConfig,
} from "@/lib/sync";

export interface UseSyncConfigState {
  /** Current stored config for the workspace, or null if unconfigured. */
  config: WorkspaceSyncConfig | null;
  /** Last status report we successfully fetched. */
  status: StatusReport | null;
  /**
   * Author identity sourced from git's config, used as placeholder
   * hints on the setup form. `null` while we haven't loaded it yet for
   * the current workspace.
   */
  defaultAuthor: CommitAuthorHint | null;
  /**
   * Whether the workspace folder is already a git repository. `null`
   * while we haven't checked yet; `false` shows the "Initialize repo"
   * banner in the modal.
   */
  repoPresent: boolean | null;
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
  setOrigin: (remoteUrl: string) => Promise<void>;
  commitConfig: () => Promise<boolean>;
  runSync: (message?: string | null) => Promise<SyncResult>;
  refreshStatus: () => Promise<void>;
  refreshRepoPresent: () => Promise<void>;
}

export type UseSyncConfigReturn = UseSyncConfigState & UseSyncConfigActions;

export function useSyncConfig(workspacePath: string | null): UseSyncConfigReturn {
  const { t } = useTranslation("sync");
  const [config, setConfig] = useState<WorkspaceSyncConfig | null>(null);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [defaultAuthor, setDefaultAuthor] = useState<CommitAuthorHint | null>(null);
  const [repoPresent, setRepoPresent] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load whenever the workspace flips to a new path. We fetch
  // the stored config, the git-config author hint, and the "is this a
  // repo?" probe in parallel — the modal needs all three to render.
  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      setConfig(null);
      setStatus(null);
      setDefaultAuthor(null);
      setRepoPresent(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.allSettled([
      getSyncConfig(workspacePath),
      getDefaultSyncAuthor(workspacePath),
      isSyncRepoPresent(workspacePath),
    ])
      .then(([cfgRes, hintRes, presentRes]) => {
        if (cancelled) return;
        if (cfgRes.status === "fulfilled") {
          setConfig(cfgRes.value);
        } else {
          setError(describeSyncError(cfgRes.reason, t));
        }
        // Author hint and repo presence are advisory: a failure is not
        // fatal, just leaves the field at its previous default.
        if (hintRes.status === "fulfilled") setDefaultAuthor(hintRes.value);
        else setDefaultAuthor(null);
        if (presentRes.status === "fulfilled") setRepoPresent(presentRes.value);
        else setRepoPresent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, t]);

  /**
   * Wrap an imperative action with busy/error state management.
   * Centralises the try/catch so individual actions stay one-liners.
   */
  const guarded = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (e) {
        const msg = describeSyncError(e, t);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

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
      // Re-probe so the modal flips out of the "needs init" state once
      // the underlying `.git` directory exists.
      try {
        const present = await isSyncRepoPresent(workspacePath);
        setRepoPresent(present);
      } catch {
        // best-effort: leave the previous value in place
      }
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
    [guarded, workspacePath],
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
  }, [guarded, workspacePath]);

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
  }, [workspacePath]);

  return {
    config,
    status,
    defaultAuthor,
    repoPresent,
    loading,
    busy,
    error,
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
