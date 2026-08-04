import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import type { StatusReport, SyncResult, WorkspaceSyncConfig } from "@/lib/sync";

// Sync payload fixtures plus a command router, shared by the useSyncConfig and
// useSyncActions suites.

export function config(overrides: Partial<WorkspaceSyncConfig> = {}): WorkspaceSyncConfig {
  return {
    workspacePath: "/w",
    backend: "git",
    remoteUrl: "https://example.com/r.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    author: null,
    ...overrides,
  };
}

export function status(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    kind: "git",
    clean: true,
    ahead: 0,
    behind: 0,
    conflicts: [],
    lastSyncUnix: null,
    ...overrides,
  };
}

export function syncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    kind: "git",
    pulledCount: 0,
    committedCount: 0,
    pushedCount: 0,
    conflicts: [],
    completedUnix: 1000,
    ...overrides,
  };
}

// Route each Tauri command to a configurable handler, so individual tests
// can opt in to specific responses without ordering the .mockResolvedValueOnce calls.
export function routeInvoke(handlers: Record<string, (args: unknown) => unknown>) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    if (!handler) return Promise.reject(new Error(`no handler for ${cmd}`));
    try {
      return Promise.resolve(handler(args) as never);
    } catch (e) {
      return Promise.reject(e);
    }
  });
}
