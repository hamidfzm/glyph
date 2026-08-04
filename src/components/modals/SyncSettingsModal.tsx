// Cloud-sync settings modal.
//
// Per-workspace, not global — each folder tab has its own remote, branch,
// conflict policy, etc. Lives in its own modal (rather than as a tab in
// the global Settings modal) because the underlying concept is
// workspace-scoped and pulling it into the global modal would conflate
// "preferences for the app" with "config for this workspace".
//
// Three states the user can land in:
// 1. No folder workspace open — empty state, prompts them to open one.
// 2. Folder workspace open, no sync config stored — setup form. User
//    fills in remote URL, optional token, author identity, conflict
//    policy, etc. and clicks Save (config) and/or Sync now.
// 3. Folder workspace open, sync configured — same form prefilled with
//    the stored values plus a Disable button and a Sync now button.
//
// All Tauri command calls are routed through `useSyncConfig`, so this
// component stays a thin form view.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
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

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SyncSettingsModal({ open, onClose }: SyncSettingsModalProps) {
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

  // Close on Escape (matches SettingsModal behaviour).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

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

  return (
    <div
      className="settings-overlay"
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("modal.title")}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t("modal.heading")}</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t("modal.close")}
          >
            <ModalCloseIcon />
          </button>
        </div>

        <div className="settings-body settings-sync">
          {!workspacePath ? (
            <p className="settings-empty">{t("empty")}</p>
          ) : (
            <>
              <p className="settings-section-description">
                <Trans i18nKey="sync:description" components={{ kbd: <kbd /> }} />
              </p>

              {loading && <p className="settings-busy">{t("loading")}</p>}

              {!loading && repoPresent === false && (
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

              {!loading && (
                <>
                  <SyncConfigForm
                    form={form}
                    onChange={update}
                    configured={!!config}
                    defaultAuthorName={defaultAuthor?.name}
                    defaultAuthorEmail={defaultAuthor?.email}
                  />

                  {error && <p className="settings-error">{error}</p>}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="settings-primary-btn"
                      onClick={handleSave}
                      disabled={busy}
                    >
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
