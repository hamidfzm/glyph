import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsSyncActions } from "@/hooks/useSettingsSyncActions";
import {
  EMPTY_PLAN,
  type PluginPlan,
  type SettingsRepoConfig,
  type SettingsSyncOutcome,
  type SkippedFile,
} from "@/lib/settingsSync";
import {
  getSettingsSyncConfig,
  getSettingsSyncDefaultAuthor,
  getSettingsSyncPluginPlan,
  getSettingsSyncStatus,
  hasSettingsSyncToken,
} from "@/lib/settingsSyncCommands";
import type { CommitAuthorHint, StatusReport, SyncResult } from "@/lib/sync";
import { describeSyncError } from "@/lib/syncErrors";

/**
 * The Settings Sync tab's view of the settings repo: whether and how it is
 * connected, what the last operation brought back, and the actions on it.
 */
export function useSettingsSync() {
  const { t } = useTranslation("sync");
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<SettingsRepoConfig | null>(null);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [defaultAuthor, setDefaultAuthor] = useState<CommitAuthorHint | null>(null);
  const [tokenStored, setTokenStored] = useState(false);
  const [plan, setPlan] = useState<PluginPlan>(EMPTY_PLAN);
  const [outcomeConflicts, setOutcomeConflicts] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Read the repo's current standing: config, and for a live connection its
   *  status and plugin plan. Advisory reads that fail leave what was there. */
  const refresh = useCallback(async () => {
    const next = await getSettingsSyncConfig();
    setConfig(next);
    if (next?.phase !== "active") {
      setStatus(null);
      return;
    }
    const [statusResult, planResult] = await Promise.allSettled([
      getSettingsSyncStatus(),
      getSettingsSyncPluginPlan(),
    ]);
    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    if (planResult.status === "fulfilled") setPlan(planResult.value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([refresh(), getSettingsSyncDefaultAuthor(), hasSettingsSyncToken()])
      .then(([refreshed, author, token]) => {
        if (cancelled) return;
        if (refreshed.status === "rejected") setError(describeSyncError(refreshed.reason, t));
        if (author.status === "fulfilled") setDefaultAuthor(author.value);
        if (token.status === "fulfilled") setTokenStored(token.value);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, t]);

  const applyOutcome = useCallback((outcome: SettingsSyncOutcome) => {
    setOutcomeConflicts(outcome.conflicts);
    setSkipped(outcome.skipped);
    setLastResult(outcome.result);
    // A sync that stopped on conflicts landed nothing, so the plan stands.
    if (outcome.conflicts.length === 0) setPlan(outcome.plugins);
  }, []);

  const forget = useCallback(() => {
    setConfig(null);
    setStatus(null);
    setPlan(EMPTY_PLAN);
    setOutcomeConflicts([]);
    setSkipped([]);
    setLastResult(null);
    setTokenStored(false);
  }, []);

  const guarded = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(describeSyncError(err, t));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const actions = useSettingsSyncActions({
    guarded,
    refresh,
    applyOutcome,
    forget,
    setTokenStored,
  });

  const conflicts = outcomeConflicts.length > 0 ? outcomeConflicts : (status?.conflicts ?? []);

  return {
    loading,
    config,
    status,
    defaultAuthor,
    tokenStored,
    plan,
    conflicts,
    skipped,
    lastResult,
    busy,
    error,
    ...actions,
  };
}
