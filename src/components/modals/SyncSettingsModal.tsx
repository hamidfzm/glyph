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
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useSyncConfigContext } from "@/contexts/SyncConfigContext";
import {
  type ConflictPolicy,
  defaultConfigFor,
  type SyncResult,
  type WorkspaceSyncConfig,
} from "@/lib/sync";

const CONFLICT_POLICIES: { id: ConflictPolicy; label: string; description: string }[] = [
  { id: "prompt", label: "Prompt me", description: "Stop on conflicts and open the resolver." },
  {
    id: "prefer-remote",
    label: "Take remote",
    description: "Discard local edits when they clash.",
  },
  { id: "prefer-local", label: "Keep local", description: "Push local edits over the remote." },
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

function relativeTime(unix: number | null): string {
  if (!unix) return "never";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SyncSettingsModal({ open, onClose }: SyncSettingsModalProps) {
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
      aria-label="Cloud Sync settings"
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Cloud Sync</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close cloud sync settings"
          >
            <ModalCloseIcon />
          </button>
        </div>

        <div className="settings-body settings-sync">
          {!workspacePath ? (
            <p className="settings-empty">
              Open a folder workspace to configure cloud sync for it. Single-file tabs sync as part
              of whichever folder they live in.
            </p>
          ) : (
            <>
              <p className="settings-section-description">
                Git-backed sync for this workspace. Glyph ships with its own libgit2 build — no
                system <kbd>git</kbd> needed.
              </p>

              {loading && <p className="settings-busy">Loading…</p>}

              {!loading && repoPresent === false && (
                <div className="settings-warning" data-testid="sync-init-banner">
                  <div>This folder isn't a git repository yet.</div>
                  <button
                    type="button"
                    className="settings-secondary-btn"
                    onClick={handleInitRepo}
                    disabled={busy}
                  >
                    Initialize repo
                  </button>
                </div>
              )}

              {!loading && (
                <>
                  <label className="settings-field">
                    <span className="settings-field-label">
                      Remote URL{" "}
                      <span className="settings-field-hint">(blank = local-only history)</span>
                    </span>
                    <input
                      type="url"
                      className="settings-input"
                      placeholder="https://github.com/you/notes.git"
                      value={form.remoteUrl}
                      onChange={(e) => update("remoteUrl", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">Branch</span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="main"
                      value={form.remoteBranch}
                      onChange={(e) => update("remoteBranch", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <fieldset className="settings-field">
                    <legend className="settings-field-label">Conflict policy</legend>
                    <div className="settings-segmented">
                      {CONFLICT_POLICIES.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          className="settings-segmented-option"
                          data-active={form.conflictPolicy === p.id}
                          onClick={() => update("conflictPolicy", p.id)}
                          title={p.description}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="settings-field">
                    <span className="settings-field-label">Author name</span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={defaultAuthor?.name ?? "defaults to your git config"}
                      value={form.authorName}
                      onChange={(e) => update("authorName", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">Author email</span>
                    <input
                      type="email"
                      className="settings-input"
                      placeholder={defaultAuthor?.email ?? "you@example.com"}
                      value={form.authorEmail}
                      onChange={(e) => update("authorEmail", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">
                      Personal access token{" "}
                      <span className="settings-field-hint">(HTTPS only)</span>
                    </span>
                    <input
                      type="password"
                      className="settings-input"
                      placeholder={config ? "saved — leave blank to keep" : "ghp_…"}
                      value={form.token}
                      onChange={(e) => update("token", e.target.value)}
                      autoComplete="off"
                    />
                    <span className="settings-field-hint">
                      Stored in memory only for now. The next release routes it through your OS
                      keychain.
                    </span>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">
                      Commit message{" "}
                      <span className="settings-field-hint">
                        (blank = auto-generated from changes)
                      </span>
                    </span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g. Update notes"
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
                      {config ? "Save changes" : "Save config"}
                    </button>
                    {config && (
                      <>
                        <button
                          type="button"
                          className="settings-primary-btn"
                          onClick={handleSyncNow}
                          disabled={busy}
                        >
                          Sync now
                        </button>
                        <button
                          type="button"
                          className="settings-secondary-btn"
                          onClick={refreshStatus}
                          disabled={busy}
                        >
                          Refresh status
                        </button>
                        <button
                          type="button"
                          className="settings-danger-btn"
                          onClick={() => remove()}
                          disabled={busy}
                        >
                          Disable sync
                        </button>
                      </>
                    )}
                  </div>

                  {(status || lastSync) && (
                    <div className="settings-sync-status" data-testid="sync-status">
                      {status && (
                        <>
                          <div>
                            Working tree: <strong>{status.clean ? "clean" : "dirty"}</strong>
                          </div>
                          <div>
                            Ahead: <strong>{status.ahead}</strong> · Behind:{" "}
                            <strong>{status.behind}</strong>
                          </div>
                          {status.conflicts.length > 0 && (
                            <div className="settings-warning">
                              Unresolved conflicts: {status.conflicts.join(", ")}
                            </div>
                          )}
                          <div>Last sync: {relativeTime(status.lastSyncUnix)}</div>
                        </>
                      )}
                      {lastSync && (
                        <div>
                          Last run: pulled <strong>{lastSync.pulledCount}</strong>, committed{" "}
                          <strong>{lastSync.committedCount}</strong>, pushed{" "}
                          <strong>{lastSync.pushedCount}</strong>
                          {lastSync.conflicts.length > 0
                            ? `, ${lastSync.conflicts.length} conflict(s) need attention`
                            : ""}
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
