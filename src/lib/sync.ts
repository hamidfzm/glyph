// TypeScript mirrors of the Rust types in `src-tauri/src/sync/{backend,config,error}.rs`.
//
// Keep these in lockstep with the Rust definitions — a missing field
// or a typo'd union variant only surfaces at runtime when the Tauri
// command returns a payload the frontend can't parse. The serde
// renames on the Rust side already match camelCase on every property
// here, plus kebab-case on the string-tagged unions.

import { invoke } from "@tauri-apps/api/core";

export type BackendKind = "git";

export type ConflictPolicy = "prompt" | "prefer-remote" | "prefer-local";

export interface CommitIdentity {
  name: string;
  email: string;
}

/**
 * Best-effort author identity sourced from git's config. Used as
 * placeholder hints on the Cloud Sync setup form — both fields are
 * independently nullable because `user.name` and `user.email` can be
 * set in isolation and a brand-new install has neither.
 */
export interface CommitAuthorHint {
  name: string | null;
  email: string | null;
}

export interface WorkspaceSyncConfig {
  workspacePath: string;
  backend: BackendKind;
  remoteUrl: string;
  remoteBranch: string;
  conflictPolicy: ConflictPolicy;
  autoSyncSeconds: number | null;
  author: CommitIdentity | null;
}

export interface StatusReport {
  kind: BackendKind;
  clean: boolean;
  ahead: number;
  behind: number;
  conflicts: string[];
  lastSyncUnix: number | null;
}

export interface SyncResult {
  kind: BackendKind;
  pulledCount: number;
  committedCount: number;
  pushedCount: number;
  conflicts: string[];
  completedUnix: number;
}

/** Frontend-tagged shape of `sync::error::SyncError`. */
export type SyncErrorKind =
  | "not-configured"
  | "auth-failed"
  | "network"
  | "conflict"
  | "invalid-state"
  | "io"
  | "backend";

export interface SyncError {
  kind: SyncErrorKind;
  /** String for most variants; `string[]` for `conflict`. */
  message?: string | string[];
}

/**
 * Best-effort default config for a freshly opened workspace. The
 * Settings UI prefills the form with this and lets the user edit.
 */
export function defaultConfigFor(workspacePath: string): WorkspaceSyncConfig {
  return {
    workspacePath,
    backend: "git",
    remoteUrl: "",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    autoSyncSeconds: null,
    author: null,
  };
}

// -- Command wrappers --------------------------------------------------------
//
// One function per Tauri command. Always go through these instead of calling
// `invoke()` directly from components — keeps the contract typed and lets
// tests stub a single module.

export function setSyncConfig(config: WorkspaceSyncConfig): Promise<void> {
  return invoke("sync_set_config", { config });
}

export function getSyncConfig(workspacePath: string): Promise<WorkspaceSyncConfig | null> {
  return invoke("sync_get_config", { workspacePath });
}

export function removeSyncConfig(workspacePath: string): Promise<void> {
  return invoke("sync_remove_config", { workspacePath });
}

export function setSyncToken(workspacePath: string, token: string): Promise<void> {
  return invoke("sync_set_token", { workspacePath, token });
}

export function clearSyncToken(workspacePath: string): Promise<void> {
  return invoke("sync_clear_token", { workspacePath });
}

export function initSyncRepo(
  workspacePath: string,
  defaultBranch: string | null,
  remoteUrl: string | null,
): Promise<void> {
  return invoke("sync_init_repo", { workspacePath, defaultBranch, remoteUrl });
}

export function cloneSyncRemote(
  workspacePath: string,
  remoteUrl: string,
  token: string | null,
): Promise<void> {
  return invoke("sync_clone_remote", { workspacePath, remoteUrl, token });
}

export function getSyncStatus(workspacePath: string): Promise<StatusReport> {
  return invoke("sync_status", { workspacePath });
}

export function runSync(workspacePath: string, message?: string | null): Promise<SyncResult> {
  return invoke("sync_run", { workspacePath, message: message ?? null });
}

export function getDefaultSyncAuthor(workspacePath: string): Promise<CommitAuthorHint> {
  return invoke("sync_default_author", { workspacePath });
}

export function isSyncRepoPresent(workspacePath: string): Promise<boolean> {
  return invoke("sync_repo_present", { workspacePath });
}

/**
 * Human-readable message for a `SyncError` payload. The Tauri command
 * surface returns the tagged error JSON; the UI usually wants one
 * sentence to show in a toast or inline beneath the form.
 */
export function describeSyncError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "Unknown sync error.");
  const e = err as SyncError;
  switch (e.kind) {
    case "not-configured":
      return "This workspace isn't configured for sync yet.";
    case "auth-failed":
      return `Authentication failed${e.message ? `: ${String(e.message)}` : "."}`;
    case "network":
      return `Couldn't reach the remote${e.message ? `: ${String(e.message)}` : "."}`;
    case "conflict": {
      const files = Array.isArray(e.message) ? e.message : [];
      return `Resolve conflicts in ${files.length} file(s) before syncing again.`;
    }
    case "invalid-state":
      return `Repository is in an unexpected state${e.message ? `: ${String(e.message)}` : "."}`;
    case "io":
      return `I/O error${e.message ? `: ${String(e.message)}` : "."}`;
    case "backend":
      return `Sync backend error${e.message ? `: ${String(e.message)}` : "."}`;
    default:
      return "Unknown sync error.";
  }
}
