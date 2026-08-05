import { invoke } from "@tauri-apps/api/core";
import type { CommitAuthorHint, StatusReport, SyncResult, WorkspaceSyncConfig } from "@/lib/sync";

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

/**
 * Write `[remote "origin"] url = <remoteUrl>` into the workspace's
 * `.git/config`. Called from the modal's Save flow when the workspace
 * is already a git repo so libgit2's fetch/push uses Glyph's configured
 * URL instead of whatever stale origin the existing repo carries.
 */
export function setSyncOrigin(workspacePath: string, remoteUrl: string): Promise<void> {
  return invoke("sync_set_origin", { workspacePath, remoteUrl });
}

/**
 * Commit the workspace's `.glyph/` config directory into git history when it
 * isn't tracked yet. Called from the modal's Save flow so enabling sync lands
 * the config in history immediately (and it travels with clones). Resolves to
 * `true` when a commit was created.
 */
export function commitSyncConfig(workspacePath: string): Promise<boolean> {
  return invoke("sync_commit_config", { workspacePath });
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
