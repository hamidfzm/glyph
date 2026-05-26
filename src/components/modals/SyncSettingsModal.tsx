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
import { useTabsContext } from "@/contexts/TabsContext";
import { useSyncConfig } from "@/hooks/useSyncConfig";
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

interface FormState {
  remoteUrl: string;
  remoteBranch: string;
  conflictPolicy: ConflictPolicy;
  authorName: string;
  authorEmail: string;
  autoSyncSeconds: string;
  /** Plain-text PAT. Never displayed back — re-entered each session. */
  token: string;
}

function formFromConfig(config: WorkspaceSyncConfig): FormState {
  return {
    remoteUrl: config.remoteUrl,
    remoteBranch: config.remoteBranch,
    conflictPolicy: config.conflictPolicy,
    authorName: config.author?.name ?? "",
    authorEmail: config.author?.email ?? "",
    autoSyncSeconds:
      config.autoSyncSeconds === null || config.autoSyncSeconds === undefined
        ? ""
        : String(config.autoSyncSeconds),
    token: "",
  };
}

function configFromForm(workspacePath: string, form: FormState): WorkspaceSyncConfig {
  const auto = form.autoSyncSeconds.trim();
  const parsed = auto === "" ? null : Number.parseInt(auto, 10);
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
    autoSyncSeconds: parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    author,
  };
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
  const { activeTab } = useTabsContext();
  const workspacePath = activeTab?.kind === "folder" ? activeTab.root : null;
  const { config, status, loading, busy, error, save, remove, setToken, runSync, refreshStatus } =
    useSyncConfig(workspacePath);

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

  const handleSave = async () => {
    if (!workspacePath) return;
    const next = configFromForm(workspacePath, form);
    if (!next.remoteUrl) return;
    await save(next);
    if (form.token.trim()) {
      await setToken(form.token.trim());
      setForm((prev) => ({ ...prev, token: "" }));
    }
  };

  const handleSyncNow = async () => {
    try {
      const result = await runSync();
      setLastSync(result);
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
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

              {!loading && (
                <>
                  <label className="settings-field">
                    <span className="settings-field-label">Remote URL</span>
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
                      placeholder="defaults to your git config"
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
                      placeholder="you@example.com"
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
                      Auto-sync interval{" "}
                      <span className="settings-field-hint">(seconds, blank = off)</span>
                    </span>
                    <input
                      type="number"
                      className="settings-input"
                      min={30}
                      placeholder="off"
                      value={form.autoSyncSeconds}
                      onChange={(e) => update("autoSyncSeconds", e.target.value)}
                    />
                  </label>

                  {error && <p className="settings-error">{error}</p>}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="settings-primary-btn"
                      onClick={handleSave}
                      disabled={busy || !form.remoteUrl.trim()}
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
