import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncConfig } from "@/hooks/useSyncConfig";
import { config, routeInvoke } from "@/test/fixtures/sync";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useSyncActions commands", () => {
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

  it("commitConfig() forwards to sync_commit_config and is a no-op without a workspace", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_commit_config: () => true,
    });
    const { result } = renderHook(() => useSyncConfig("/w"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let committed: boolean | undefined;
    await act(async () => {
      committed = await result.current.commitConfig();
    });
    expect(committed).toBe(true);
    expect(invoke).toHaveBeenCalledWith("sync_commit_config", { workspacePath: "/w" });

    // Null workspace -- no command call, resolves to false.
    vi.mocked(invoke).mockClear();
    const { result: noWs } = renderHook(() => useSyncConfig(null));
    let result2: boolean | undefined;
    await act(async () => {
      result2 = await noWs.current.commitConfig();
    });
    expect(result2).toBe(false);
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

  it("remove() / initRepo() are no-ops once the workspace path has cleared", async () => {
    // After the workspace path flips to null mid-session, the cached
    // imperative actions still hold their old workspacePath in closure
    // via the next render. Re-rendering with `null` rebuilds the
    // callbacks with `workspacePath = null`, exercising the early-return
    // guards on lines 155 (remove) and 176 (initRepo).
    routeInvoke({
      sync_get_config: () => config(),
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_remove_config: () => null,
      sync_init_repo: () => null,
    });
    const { result, rerender } = renderHook(({ ws }) => useSyncConfig(ws), {
      initialProps: { ws: "/w" as string | null },
    });
    await waitFor(() => expect(result.current.config).not.toBeNull());

    rerender({ ws: null });
    await waitFor(() => expect(result.current.config).toBeNull());

    vi.mocked(invoke).mockClear();
    await act(async () => {
      await result.current.remove();
      await result.current.initRepo("main", null);
      await result.current.setToken("ghp_x");
      await result.current.clearToken();
    });
    // The guards short-circuit before any Tauri command fires.
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
