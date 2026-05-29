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

  it("setOrigin() forwards to sync_set_origin and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_origin: () => null,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOrigin("https://x.com/r.git");
    });
    expect(invoke).toHaveBeenCalledWith("sync_set_origin", {
      workspacePath: "/w",
      remoteUrl: "https://x.com/r.git",
    });

    // Now with a null workspace -- no command call.
    vi.mocked(invoke).mockClear();
    const { result: noWs } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await noWs.current.setOrigin("https://x.com/r.git");
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clearToken() forwards to sync_clear_token and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_clear_token: () => null,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.clearToken();
    });
    expect(invoke).toHaveBeenCalledWith("sync_clear_token", { workspacePath: "/w" });

    vi.mocked(invoke).mockClear();
    const { result: noWs } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await noWs.current.clearToken();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("setToken() forwards to sync_set_token and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_token: () => null,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setToken("tok");
    });
    expect(invoke).toHaveBeenCalledWith("sync_set_token", {
      workspacePath: "/w",
      token: "tok",
    });

    vi.mocked(invoke).mockClear();
    const { result: noWs } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await noWs.current.setToken("tok");
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cloneRemote() forwards to sync_clone_remote and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_clone_remote: () => null,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.cloneRemote("https://x.com/r.git", "tok");
    });
    expect(invoke).toHaveBeenCalledWith("sync_clone_remote", {
      workspacePath: "/w",
      remoteUrl: "https://x.com/r.git",
      token: "tok",
    });

    vi.mocked(invoke).mockClear();
    const { result: noWs } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await noWs.current.cloneRemote("https://x.com/r.git", null);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refreshStatus() swallows errors when sync_status rejects", async () => {
    routeInvoke({
      sync_get_config: () => config(),
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_status: () => {
        throw { kind: "backend", message: "boom" };
      },
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refreshStatus();
    });
    // Error is captured by guarded(), status stays null, no re-throw.
    expect(result.current.status).toBeNull();
    expect(result.current.error).toMatch(/Sync backend error: boom/);
  });

  it("refreshStatus() clears status and skips invoke when workspacePath is null", async () => {
    const { result } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await result.current.refreshStatus();
    });
    expect(result.current.status).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refreshRepoPresent() resets state to null when workspacePath is null", async () => {
    const { result } = renderHook(() => useSyncConfig(null));
    await act(async () => {
      await result.current.refreshRepoPresent();
    });
    expect(result.current.repoPresent).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refreshRepoPresent() swallows errors and keeps the previous value", async () => {
    let probeCount = 0;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => {
        probeCount += 1;
        if (probeCount === 1) return true;
        throw { kind: "io", message: "no access" };
      },
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repoPresent).toBe(true);

    await act(async () => {
      await result.current.refreshRepoPresent();
    });
    // Previous true is retained when the probe fails.
    expect(result.current.repoPresent).toBe(true);
  });

  it("runSync still returns the result when post-sync status refresh rejects", async () => {
    const result1 = syncResult({ pulledCount: 1, committedCount: 1, pushedCount: 1 });
    routeInvoke({
      sync_get_config: () => config(),
      sync_run: () => result1,
      sync_status: () => {
        throw { kind: "backend", message: "status read failed" };
      },
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
    expect(result.current.status).toBeNull();
  });

  it("changing workspacePath triggers a fresh load and clears stale defaultAuthor/repoPresent", async () => {
    const config1 = config({ workspacePath: "/w1" });
    const config2 = config({ workspacePath: "/w2", remoteUrl: "https://other.git" });
    routeInvoke({
      sync_get_config: (args) => {
        const a = args as { workspacePath: string };
        return a.workspacePath === "/w1" ? config1 : config2;
      },
      sync_default_author: (args) => {
        const a = args as { workspacePath: string };
        return a.workspacePath === "/w1"
          ? { name: "First", email: "first@x.com" }
          : { name: "Second", email: "second@x.com" };
      },
      sync_repo_present: (args) => {
        const a = args as { workspacePath: string };
        return a.workspacePath === "/w1";
      },
    });
    const { result, rerender } = renderHook(({ ws }) => useSyncConfig(ws), {
      initialProps: { ws: "/w1" as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config?.workspacePath).toBe("/w1");
    expect(result.current.defaultAuthor?.name).toBe("First");
    expect(result.current.repoPresent).toBe(true);

    rerender({ ws: "/w2" });
    await waitFor(() => expect(result.current.config?.workspacePath).toBe("/w2"));
    expect(result.current.defaultAuthor?.name).toBe("Second");
    expect(result.current.repoPresent).toBe(false);
  });

  it("setting workspacePath to null clears all state", async () => {
    routeInvoke({
      sync_get_config: () => config(),
      sync_default_author: () => ({ name: "X", email: "x@x.com" }),
      sync_repo_present: () => true,
    });
    const { result, rerender } = renderHook(({ ws }) => useSyncConfig(ws), {
      initialProps: { ws: "/w" as string | null },
    });
    await waitFor(() => expect(result.current.config).not.toBeNull());

    rerender({ ws: null });
    await waitFor(() => expect(result.current.config).toBeNull());
    expect(result.current.status).toBeNull();
    expect(result.current.defaultAuthor).toBeNull();
    expect(result.current.repoPresent).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
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
