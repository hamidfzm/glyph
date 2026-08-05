// TypeScript mirrors of the Rust types in `src-tauri/src/sync/{backend,config,error}.rs`.
//
// Keep these in lockstep with the Rust definitions — a missing field
// or a typo'd union variant only surfaces at runtime when the Tauri
// command returns a payload the frontend can't parse. The serde
// renames on the Rust side already match camelCase on every property
// here, plus kebab-case on the string-tagged unions.

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
    author: null,
  };
}
