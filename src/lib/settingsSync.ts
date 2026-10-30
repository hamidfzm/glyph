// TypeScript mirrors of the settings repo's types in
// `src-tauri/src/sync/settings_repo/` (camelCase fields, kebab-case unions).

import type { CommitIdentity, SyncResult } from "@/lib/sync";

/** Every window hears this after a settings sync rewrote settings on disk. */
export const SETTINGS_SYNCED_EVENT = "settings-synced";

export interface SettingsSyncedPayload {
  /** Plugins whose settings the sync changed. */
  pluginIds: string[];
}

export type SettingsSyncPhase = "choosing" | "active";

export interface SettingsRepoConfig {
  remoteUrl: string;
  branch: string;
  author: CommitIdentity | null;
  phase: SettingsSyncPhase;
}

export type SyncedPluginSource = "marketplace" | "local" | "core" | "unknown";

export interface SyncedPlugin {
  id: string;
  source: SyncedPluginSource;
  version: string;
  enabled: boolean;
}

export interface PluginPlan {
  plugins: SyncedPlugin[];
  /** Installed here, removed from the synced setup on another machine. */
  removals: string[];
}

export type SkipReason =
  | "not-a-file"
  | "not-a-folder"
  | "too-large"
  | "not-json"
  | "not-an-object"
  | "unknown-name"
  | "duplicate-name"
  | "too-many"
  | "bad-entry";

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface SettingsSyncOutcome {
  phase: SettingsSyncPhase;
  result: SyncResult | null;
  conflicts: string[];
  skipped: SkippedFile[];
  plugins: PluginPlan;
}

export type SetupChoice = "use-synced" | "replace-synced";

export type ConflictSide = "local" | "remote";

export interface ConflictPick {
  path: string;
  side: ConflictSide;
}

export const EMPTY_PLAN: PluginPlan = { plugins: [], removals: [] };
