import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncConfig } from "@/hooks/useSyncConfig";
import type { SyncResult } from "@/lib/sync";
import { config, routeInvoke, status, syncResult } from "@/test/fixtures/sync";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useSyncActions status refresh", () => {
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
});
