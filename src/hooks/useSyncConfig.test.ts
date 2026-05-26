import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusReport, SyncResult, WorkspaceSyncConfig } from "@/lib/sync";
import { useSyncConfig } from "./useSyncConfig";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

function config(overrides: Partial<WorkspaceSyncConfig> = {}): WorkspaceSyncConfig {
  return {
    workspacePath: "/w",
    backend: "git",
    remoteUrl: "https://example.com/r.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    autoSyncSeconds: null,
    author: null,
    ...overrides,
  };
}

function status(overrides: Partial<StatusReport> = {}): StatusReport {
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

function syncResult(overrides: Partial<SyncResult> = {}): SyncResult {
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
function routeInvoke(handlers: Record<string, (args: unknown) => unknown>) {
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

describe("useSyncConfig", () => {
  it("stays idle when workspacePath is null", () => {
    const { result } = renderHook(() => useSyncConfig(null));
    expect(result.current.config).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads the stored config on mount", async () => {
    const stored = config();
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });

    const { result } = renderHook(() => useSyncConfig("/w"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual(stored);
    expect(result.current.error).toBeNull();
  });

  it("loads defaultAuthor and repoPresent on mount", async () => {
    const hint = { name: "Hamid", email: "h@example.com" };
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => hint,
      sync_repo_present: () => false,
    });

    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.defaultAuthor).toEqual(hint);
    expect(result.current.repoPresent).toBe(false);
  });

  it("surfaces load failures via describeSyncError", async () => {
    routeInvoke({
      sync_get_config: () => {
        throw { kind: "io", message: "permission denied" };
      },
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
    });

    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/I\/O error: permission denied/);
    expect(result.current.config).toBeNull();
  });

  it("save() invokes sync_set_config and updates local state", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_set_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const next = config({ remoteUrl: "https://other.git" });
    await act(async () => {
      await result.current.save(next);
    });
    expect(invoke).toHaveBeenCalledWith("sync_set_config", { config: next });
    expect(result.current.config).toEqual(next);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("remove() clears config + status and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => config(),
      sync_remove_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    await act(async () => {
      await result.current.remove();
    });
    expect(invoke).toHaveBeenCalledWith("sync_remove_config", { workspacePath: "/w" });
    expect(result.current.config).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it("runSync() refreshes status after a successful run", async () => {
    const result1 = syncResult({ pulledCount: 2 });
    const stat = status({ ahead: 1, behind: 0 });
    routeInvoke({
      sync_get_config: () => config(),
      sync_run: () => result1,
      sync_status: () => stat,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let out: SyncResult | undefined;
    await act(async () => {
      out = await result.current.runSync();
    });
    expect(out).toEqual(result1);
    expect(result.current.status).toEqual(stat);
  });

  it("runSync(message) forwards the commit message to the command", async () => {
    const result1 = syncResult({ committedCount: 1 });
    routeInvoke({
      sync_get_config: () => config(),
      sync_run: (args) => {
        // Capture and assert inside the handler so the message lands
        // unfiltered by the routeInvoke happy-path serialisation.
        expect(args).toEqual({ workspacePath: "/w", message: "fix typo" });
        return result1;
      },
      sync_status: () => status(),
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runSync("fix typo");
    });
    expect(invoke).toHaveBeenCalledWith("sync_run", {
      workspacePath: "/w",
      message: "fix typo",
    });
  });

  it("refreshStatus() captures the latest status report", async () => {
    const stat = status({ ahead: 3, behind: 1 });
    routeInvoke({
      sync_get_config: () => config(),
      sync_status: () => stat,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refreshStatus();
    });
    expect(result.current.status).toEqual(stat);
  });

  it("runSync() throws when no workspace is open", async () => {
    const { result } = renderHook(() => useSyncConfig(null));
    await expect(result.current.runSync()).rejects.toThrow(/no workspace open/);
  });

  it("initRepo() invokes sync_init_repo and re-probes repo presence", async () => {
    // First call: workspace isn't a repo yet. After init, the re-probe
    // flips repoPresent to true.
    let probeCount = 0;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => {
        probeCount += 1;
        return probeCount !== 1;
      },
      sync_init_repo: () => null,
    });

    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repoPresent).toBe(false);

    await act(async () => {
      await result.current.initRepo("main", null);
    });
    expect(invoke).toHaveBeenCalledWith("sync_init_repo", {
      workspacePath: "/w",
      defaultBranch: "main",
      remoteUrl: null,
    });
    expect(result.current.repoPresent).toBe(true);
  });

  it("refreshRepoPresent() re-checks repo presence on demand", async () => {
    let probeCount = 0;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => {
        probeCount += 1;
        return probeCount !== 1;
      },
    });

    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repoPresent).toBe(false);

    await act(async () => {
      await result.current.refreshRepoPresent();
    });
    expect(result.current.repoPresent).toBe(true);
  });

  it("guarded actions populate error and re-throw on failure", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_set_config: () => {
        throw { kind: "auth-failed", message: "bad token" };
      },
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.save(config())).rejects.toBeDefined();
    });
    expect(result.current.error).toMatch(/Authentication failed: bad token/);
    expect(result.current.busy).toBe(false);
  });
});
