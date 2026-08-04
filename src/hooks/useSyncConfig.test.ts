import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncConfig } from "@/hooks/useSyncConfig";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { config, routeInvoke } from "@/test/fixtures/sync";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useSyncConfig loading", () => {
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

  it("unmounting mid-load suppresses the trailing setState (cancelled=true branch)", async () => {
    // The mount-effect's then() / finally() chain checks `cancelled` to
    // decide whether to commit state. Unmounting before the in-flight
    // Promise.allSettled resolves drives both flags to their cancelled
    // branches (covers the partial on lines 107 and 121).
    let resolveCfg: ((v: WorkspaceSyncConfig) => void) | null = null;
    routeInvoke({
      sync_get_config: () =>
        new Promise<WorkspaceSyncConfig>((resolve) => {
          resolveCfg = resolve;
        }),
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const { result, unmount } = renderHook(() => useSyncConfig("/w"));
    expect(result.current.loading).toBe(true);

    // Unmount BEFORE the in-flight sync_get_config resolves, then flush.
    unmount();
    await act(async () => {
      resolveCfg?.(config());
      await Promise.resolve();
      await Promise.resolve();
    });
    // No assertion on result.current after unmount (React caches the last
    // snapshot). The test passes if no act() warning fires.
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
