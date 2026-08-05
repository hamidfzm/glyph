// The Cloud Sync tab of Workspace Settings: git-backed sync for this folder.
//
// Config is per-workspace (stored in the folder's `.glyph/`), which is why it
// lives here rather than in the global Settings modal. Two states: no config
// stored yet (setup form), or configured (same form prefilled, plus Sync now,
// Refresh and Disable). All Tauri command calls route through `useSyncConfig`,
// so this stays a thin form view.

import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { SyncConfigForm } from "@/components/modals/sync/SyncConfigForm";
import { SyncStatusPanel } from "@/components/modals/sync/SyncStatusPanel";
import { useSyncConfigContext } from "@/contexts/SyncConfigContext";
import { defaultConfigFor, type SyncResult } from "@/lib/sync";
import {
  commitSaveConfig,
  type FormState,
  formFromConfig,
  resolveSaveConfig,
} from "@/lib/syncSettingsForm";

export function SyncSettingsTab() {
  const { t } = useTranslation("sync");
  const {
    workspacePath,
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
    initRepo,
    setOrigin,
    commitConfig,
    runSync,
    refreshStatus,
  } = useSyncConfigContext();

  const defaultForm = useMemo(
    () => formFromConfig(config ?? defaultConfigFor(workspacePath ?? "")),
    [config, workspacePath],
  );
  const [form, setForm] = useState<FormState>(defaultForm);
  useEffect(() => {
    setForm(defaultForm);
  }, [defaultForm]);

  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () =>
    commitSaveConfig(resolveSaveConfig(workspacePath, form), form.token, {
      repoPresent,
      initRepo,
      save,
      setOrigin,
      setToken,
      commitConfig,
      clearTokenField: () => setForm((prev) => ({ ...prev, token: "" })),
    });

  const handleSyncNow = async () => {
    try {
      const result = await runSync(form.commitMessage.trim() || null);
      setLastSync(result);
      // Clear the per-sync commit subject so the next run starts blank.
      setForm((prev) => ({ ...prev, commitMessage: "" }));
    } catch {
      // hook captures the error
    }
  };

  const handleInitRepo = async () => {
    try {
      await initRepo(form.remoteBranch.trim() || "main", form.remoteUrl.trim() || null);
    } catch {
      // hook captures the error
    }
  };

  if (loading) return <p className="settings-busy">{t("loading")}</p>;

  return (
    <>
      <p className="settings-section-description">
        <Trans i18nKey="sync:description" components={{ kbd: <kbd /> }} />
      </p>

      {repoPresent === false && (
        <div className="settings-warning" data-testid="sync-init-banner">
          <div>{t("notRepo")}</div>
          <button
            type="button"
            className="settings-secondary-btn"
            onClick={handleInitRepo}
            disabled={busy}
          >
            {t("initRepo")}
          </button>
        </div>
      )}

      <SyncConfigForm
        form={form}
        onChange={update}
        configured={!!config}
        defaultAuthorName={defaultAuthor?.name}
        defaultAuthorEmail={defaultAuthor?.email}
      />

      {error && <p className="settings-error">{error}</p>}

      <div className="settings-actions">
        <button type="button" className="settings-primary-btn" onClick={handleSave} disabled={busy}>
          {config ? t("saveChanges") : t("saveConfig")}
        </button>
        {config && (
          <>
            <button
              type="button"
              className="settings-primary-btn"
              onClick={handleSyncNow}
              disabled={busy}
            >
              {t("syncNow")}
            </button>
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={refreshStatus}
              disabled={busy}
            >
              {t("refreshStatus")}
            </button>
            <button
              type="button"
              className="settings-danger-btn"
              onClick={() => remove()}
              disabled={busy}
            >
              {t("disable")}
            </button>
          </>
        )}
      </div>

      <SyncStatusPanel status={status} lastSync={lastSync} />
    </>
  );
}
