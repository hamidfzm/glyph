import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncToken,
  cloneSyncRemote,
  defaultConfigFor,
  describeSyncError,
  getSyncConfig,
  getSyncStatus,
  initSyncRepo,
  removeSyncConfig,
  runSync,
  setSyncConfig,
  setSyncToken,
  type WorkspaceSyncConfig,
} from "./sync";

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
    autoSyncSeconds: null,
    author: null,
  };
}

describe("defaultConfigFor", () => {
  it("fills in sensible defaults for a fresh workspace", () => {
    const cfg = defaultConfigFor("/workspace");
    expect(cfg.workspacePath).toBe("/workspace");
    expect(cfg.backend).toBe("git");
    expect(cfg.remoteUrl).toBe("");
    expect(cfg.remoteBranch).toBe("main");
    expect(cfg.conflictPolicy).toBe("prompt");
    expect(cfg.autoSyncSeconds).toBeNull();
    expect(cfg.author).toBeNull();
  });
});

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
    ["getSyncStatus", () => getSyncStatus("/w"), "sync_status", { workspacePath: "/w" }],
    ["runSync", () => runSync("/w"), "sync_run", { workspacePath: "/w" }],
  ] as const)("%s invokes %s with the expected args", async (_name, call, cmd, args) => {
    vi.mocked(invoke).mockResolvedValueOnce(null as unknown);
    await call();
    expect(invoke).toHaveBeenCalledWith(cmd, args);
  });
});

describe("describeSyncError", () => {
  it("renders one sentence per tagged variant", () => {
    expect(describeSyncError({ kind: "not-configured" })).toMatch(/isn't configured/);
    expect(describeSyncError({ kind: "auth-failed", message: "bad token" })).toMatch(
      /Authentication failed: bad token/,
    );
    expect(describeSyncError({ kind: "auth-failed" })).toMatch(/Authentication failed\./);
    expect(describeSyncError({ kind: "network", message: "timeout" })).toMatch(/Couldn't reach/);
    expect(describeSyncError({ kind: "network" })).toMatch(/Couldn't reach the remote\./);
    expect(describeSyncError({ kind: "conflict", message: ["a", "b"] })).toMatch(
      /Resolve conflicts in 2 file/,
    );
    expect(describeSyncError({ kind: "conflict" })).toMatch(/Resolve conflicts in 0 file/);
    expect(describeSyncError({ kind: "invalid-state", message: "detached" })).toMatch(
      /unexpected state: detached/,
    );
    expect(describeSyncError({ kind: "invalid-state" })).toMatch(/unexpected state\./);
    expect(describeSyncError({ kind: "io", message: "no space" })).toMatch(/I\/O error: no space/);
    expect(describeSyncError({ kind: "io" })).toMatch(/I\/O error\./);
    expect(describeSyncError({ kind: "backend", message: "libgit2 boom" })).toMatch(
      /backend error: libgit2 boom/,
    );
    expect(describeSyncError({ kind: "backend" })).toMatch(/backend error\./);
  });

  it("handles unknown or non-object inputs", () => {
    // null and undefined both fall through the `!err` guard and pick up the fallback.
    expect(describeSyncError(null)).toMatch(/Unknown sync error/);
    expect(describeSyncError(undefined)).toMatch(/Unknown sync error/);
    expect(describeSyncError("oops")).toBe("oops");
    // Tagged variant we don't recognise still gets a fallback.
    expect(describeSyncError({ kind: "not-a-thing" } as unknown)).toMatch(/Unknown sync error/);
  });
});
