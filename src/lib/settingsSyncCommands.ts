import { invoke } from "@tauri-apps/api/core";
import type {
  ConflictPick,
  PluginPlan,
  SettingsRepoConfig,
  SettingsSyncOutcome,
  SetupChoice,
} from "@/lib/settingsSync";
import type { CommitAuthorHint, CommitIdentity, StatusReport } from "@/lib/sync";

// The settings repo's commands. None takes a path: the backend owns the
// folder the repo lives in.

export interface ConnectRequest {
  remoteUrl: string;
  branch: string;
  author: CommitIdentity | null;
  token: string | null;
}

export function getSettingsSyncConfig(): Promise<SettingsRepoConfig | null> {
  return invoke("settings_sync_get_config");
}

export function connectSettingsSync(request: ConnectRequest): Promise<SettingsSyncOutcome> {
  return invoke("settings_sync_connect", { ...request });
}

export function setSettingsSyncToken(token: string): Promise<void> {
  return invoke("settings_sync_set_token", { token });
}

export function hasSettingsSyncToken(): Promise<boolean> {
  return invoke("settings_sync_has_token");
}

export function clearSettingsSyncToken(): Promise<void> {
  return invoke("settings_sync_clear_token");
}

export function getSettingsSyncDefaultAuthor(): Promise<CommitAuthorHint> {
  return invoke("settings_sync_default_author");
}

export function getSettingsSyncStatus(): Promise<StatusReport> {
  return invoke("settings_sync_status");
}

export function runSettingsSync(): Promise<SettingsSyncOutcome> {
  return invoke("settings_sync_run");
}

export function chooseSettingsSyncSetup(choice: SetupChoice): Promise<SettingsSyncOutcome> {
  return invoke("settings_sync_choose", { choice });
}

export function resolveSettingsSync(picks: ConflictPick[]): Promise<SettingsSyncOutcome> {
  return invoke("settings_sync_resolve", { picks });
}

export function getSettingsSyncPluginPlan(): Promise<PluginPlan> {
  return invoke("settings_sync_plugin_plan");
}

export function disconnectSettingsSync(): Promise<void> {
  return invoke("settings_sync_disconnect");
}
