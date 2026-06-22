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

import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useSyncConfigContext } from "@/contexts/SyncConfigContext";
import {
  type ConflictPolicy,
  defaultConfigFor,
  type SyncResult,
  type WorkspaceSyncConfig,
} from "@/lib/sync";

const CONFLICT_POLICIES: { id: ConflictPolicy; labelKey: string; descKey: string }[] = [
  {
    id: "prompt",
    labelKey: "conflictPolicy.prompt.label",
    descKey: "conflictPolicy.prompt.description",
  },
  {
    id: "prefer-remote",
    labelKey: "conflictPolicy.preferRemote.label",
    descKey: "conflictPolicy.preferRemote.description",
  },
  {
    id: "prefer-local",
    labelKey: "conflictPolicy.preferLocal.label",
    descKey: "conflictPolicy.preferLocal.description",
  },
];

export interface FormState {
  remoteUrl: string;
  remoteBranch: string;
  conflictPolicy: ConflictPolicy;
  authorName: string;
  authorEmail: string;
  /** Plain-text PAT. Never displayed back — re-entered each session. */
  token: string;
  /**
   * Per-sync commit subject. Lives in form state (not the persisted
   * config) because it resets between runs; blank delegates to the
   * backend's auto-generator.
   */
  commitMessage: string;
}

function formFromConfig(config: WorkspaceSyncConfig): FormState {
  return {
    remoteUrl: config.remoteUrl,
    remoteBranch: config.remoteBranch,
    conflictPolicy: config.conflictPolicy,
    authorName: config.author?.name ?? "",
    authorEmail: config.author?.email ?? "",
    token: "",
    commitMessage: "",
  };
}

function configFromForm(workspacePath: string, form: FormState): WorkspaceSyncConfig {
  const author =
    form.authorName.trim() || form.authorEmail.trim()
      ? { name: form.authorName.trim(), email: form.authorEmail.trim() }
      : null;
  return {
    workspacePath,
    backend: "git",
    remoteUrl: form.remoteUrl.trim(),
    remoteBranch: form.remoteBranch.trim() || "main",
    conflictPolicy: form.conflictPolicy,
    author,
  };
}

/**
 * Resolve the config to persist from the current form, or null when there's no
 * folder workspace selected. A blank remote URL is allowed: it enables
 * local-only sync (commit history without a remote to push to).
 *
 * Exported for direct unit testing — the null path is unreachable through the
 * rendered form (the Save button is hidden with no workspace), so a DOM-driven
 * test can't exercise it.
 */
export function resolveSaveConfig(
  workspacePath: string | null,
  form: FormState,
): WorkspaceSyncConfig | null {
  if (!workspacePath) return null;
  return configFromForm(workspacePath, form);
}

interface CommitSaveDeps {
  repoPresent: boolean | null;
  initRepo: (defaultBranch: string | null, remoteUrl: string | null) => Promise<void>;
  save: (config: WorkspaceSyncConfig) => Promise<void>;
  setOrigin: (remoteUrl: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearTokenField: () => void;
  commitConfig: () => Promise<boolean>;
}

/**
 * Enable sync for the workspace: turn the folder into a git repo if it isn't
 * one, persist `next`, propagate the remote URL + token, and land the config
 * in history. A no-op when `next` is null (nothing actionable to save). Kept
 * out of the component — and exported — so the guard plus the init / origin /
 * token / commit branches can be unit-tested directly; the same paths are
 * awkward or impossible to reach by driving the form (see `resolveSaveConfig`).
 */
export async function commitSaveConfig(
  next: WorkspaceSyncConfig | null,
  token: string,
  deps: CommitSaveDeps,
): Promise<void> {
  if (!next) return;
  // Enabling sync on a plain folder turns it into a git repo first, so the
  // commit step below (and later syncs) have a repository to write to.
  if (!deps.repoPresent) {
    await deps.initRepo(next.remoteBranch, next.remoteUrl || null);
  }
  await deps.save(next);
  // Glyph's stored config is advisory; libgit2 reads `remote.origin.url`
  // from the workspace's .git/config for the actual transport. Push the
  // form value over so a Save-then-Sync uses the URL the user just typed.
  // Skipped for local-only setups (blank URL) — there's no origin to set.
  if (next.remoteUrl) {
    try {
      await deps.setOrigin(next.remoteUrl);
    } catch {
      // setOrigin failures already surface in the hook's error state.
    }
  }
  const trimmed = token.trim();
  if (trimmed) {
    await deps.setToken(trimmed);
    deps.clearTokenField();
  }
  // Commit the `.glyph/` config so it persists and travels with clones,
  // rather than waiting for the first content sync.
  try {
    await deps.commitConfig();
  } catch {
    // commitConfig failures already surface in the hook's error state.
  }
}

function relativeTime(unix: number | null, t: TFunction<"sync">): string {
  if (!unix) return t("relativeTime.never");
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return t("relativeTime.secondsAgo", { count: seconds });
  if (seconds < 3600) return t("relativeTime.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("relativeTime.hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("relativeTime.daysAgo", { count: Math.floor(seconds / 86400) });
}

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
                  <label className="settings-field">
                    <span className="settings-field-label">
                      {t("remoteUrl.label")}{" "}
                      <span className="settings-field-hint">{t("remoteUrl.hint")}</span>
                    </span>
                    <input
                      type="url"
                      className="settings-input"
                      placeholder={t("remoteUrl.placeholder")}
                      value={form.remoteUrl}
                      onChange={(e) => update("remoteUrl", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("branch.label")}</span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={t("branch.placeholder")}
                      value={form.remoteBranch}
                      onChange={(e) => update("remoteBranch", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <fieldset className="settings-field">
                    <legend className="settings-field-label">{t("conflictPolicy.legend")}</legend>
                    <div className="settings-segmented">
                      {CONFLICT_POLICIES.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          className="settings-segmented-option"
                          data-active={form.conflictPolicy === p.id}
                          onClick={() => update("conflictPolicy", p.id)}
                          title={t(p.descKey)}
                        >
                          {t(p.labelKey)}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("authorName.label")}</span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={defaultAuthor?.name ?? t("authorName.placeholder")}
                      value={form.authorName}
                      onChange={(e) => update("authorName", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("authorEmail.label")}</span>
                    <input
                      type="email"
                      className="settings-input"
                      placeholder={defaultAuthor?.email ?? t("authorEmail.placeholder")}
                      value={form.authorEmail}
                      onChange={(e) => update("authorEmail", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">
                      {t("token.label")}{" "}
                      <span className="settings-field-hint">{t("token.hint")}</span>
                    </span>
                    <input
                      type="password"
                      className="settings-input"
                      placeholder={config ? t("token.placeholderSaved") : t("token.placeholderNew")}
                      value={form.token}
                      onChange={(e) => update("token", e.target.value)}
                      autoComplete="off"
                    />
                    <span className="settings-field-hint">{t("token.note")}</span>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">
                      {t("commitMessage.label")}{" "}
                      <span className="settings-field-hint">{t("commitMessage.hint")}</span>
                    </span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={t("commitMessage.placeholder")}
                      value={form.commitMessage}
                      onChange={(e) => update("commitMessage", e.target.value)}
                    />
                  </label>

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

                  {(status || lastSync) && (
                    <div className="settings-sync-status" data-testid="sync-status">
                      {status && (
                        <>
                          <div>
                            <Trans
                              i18nKey="sync:status.workingTree"
                              components={{ strong: <strong /> }}
                              values={{
                                state: status.clean ? t("status.clean") : t("status.dirty"),
                              }}
                            />
                          </div>
                          <div>
                            <Trans
                              i18nKey="sync:status.aheadBehind"
                              components={{ strong: <strong /> }}
                              values={{ ahead: status.ahead, behind: status.behind }}
                            />
                          </div>
                          {status.conflicts.length > 0 && (
                            <div className="settings-warning">
                              {t("status.conflicts", { files: status.conflicts.join(", ") })}
                            </div>
                          )}
                          <div>
                            {t("status.lastSync", { time: relativeTime(status.lastSyncUnix, t) })}
                          </div>
                        </>
                      )}
                      {lastSync && (
                        <div>
                          <Trans
                            i18nKey="sync:status.lastRun"
                            components={{ strong: <strong /> }}
                            values={{
                              pulled: lastSync.pulledCount,
                              committed: lastSync.committedCount,
                              pushed: lastSync.pushedCount,
                              suffix:
                                lastSync.conflicts.length > 0
                                  ? t("status.lastRunConflicts", {
                                      count: lastSync.conflicts.length,
                                    })
                                  : "",
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
