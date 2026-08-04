import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "./sync";
import {
  clearSyncToken,
  cloneSyncRemote,
  commitSyncConfig,
  getDefaultSyncAuthor,
  getSyncConfig,
  getSyncStatus,
  initSyncRepo,
  isSyncRepoPresent,
  removeSyncConfig,
  runSync,
  setSyncConfig,
  setSyncToken,
} from "./syncCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

function makeConfig(): WorkspaceSyncConfig {
  return {
    workspacePath: "/w",
    backend: "git",
    remoteUrl: "https://example.com/n.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    author: null,
  };
}

describe("sync command wrappers", () => {
  it.each([
    [
      "setSyncConfig",
      () => setSyncConfig(makeConfig()),
      "sync_set_config",
      { config: makeConfig() },
    ],
    ["getSyncConfig", () => getSyncConfig("/w"), "sync_get_config", { workspacePath: "/w" }],
    [
      "removeSyncConfig",
      () => removeSyncConfig("/w"),
      "sync_remove_config",
      { workspacePath: "/w" },
    ],
    [
      "setSyncToken",
      () => setSyncToken("/w", "tok"),
      "sync_set_token",
      { workspacePath: "/w", token: "tok" },
    ],
    ["clearSyncToken", () => clearSyncToken("/w"), "sync_clear_token", { workspacePath: "/w" }],
    [
      "initSyncRepo",
      () => initSyncRepo("/w", null, "https://r"),
      "sync_init_repo",
      { workspacePath: "/w", defaultBranch: null, remoteUrl: "https://r" },
    ],
    [
      "cloneSyncRemote",
      () => cloneSyncRemote("/w", "https://r", "tok"),
      "sync_clone_remote",
      { workspacePath: "/w", remoteUrl: "https://r", token: "tok" },
    ],
    [
      "commitSyncConfig",
      () => commitSyncConfig("/w"),
      "sync_commit_config",
      { workspacePath: "/w" },
    ],
    ["getSyncStatus", () => getSyncStatus("/w"), "sync_status", { workspacePath: "/w" }],
    ["runSync", () => runSync("/w"), "sync_run", { workspacePath: "/w", message: null }],
    [
      "runSync with message",
      () => runSync("/w", "fix typo"),
      "sync_run",
      { workspacePath: "/w", message: "fix typo" },
    ],
    [
      "getDefaultSyncAuthor",
      () => getDefaultSyncAuthor("/w"),
      "sync_default_author",
      { workspacePath: "/w" },
    ],
    [
      "isSyncRepoPresent",
      () => isSyncRepoPresent("/w"),
      "sync_repo_present",
      { workspacePath: "/w" },
    ],
  ] as const)("%s invokes %s with the expected args", async (_name, call, cmd, args) => {
    vi.mocked(invoke).mockResolvedValueOnce(null as unknown);
    await call();
    expect(invoke).toHaveBeenCalledWith(cmd, args);
  });
});
