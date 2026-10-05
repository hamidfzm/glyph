import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { pluginAppState, setPluginAppState } from "./appState";
import { createWorkspaceApi } from "./workspaceApi";

describe("createWorkspaceApi", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("rejects every call without the workspace:read permission", async () => {
    const api = createWorkspaceApi(() => "/ws", []);
    await expect(api.readFile("a.md")).rejects.toThrow(/workspace:read/);
    await expect(api.listFiles()).rejects.toThrow(/workspace:read/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("rejects when no workspace is open", async () => {
    const api = createWorkspaceApi(() => null, ["workspace:read"]);
    await expect(api.readFile("a.md")).rejects.toThrow(/no workspace/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("reads a workspace-relative file through the Rust command", async () => {
    vi.mocked(invoke).mockResolvedValue("# hi");
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"]);

    await expect(api.readFile("sub/a.md")).resolves.toBe("# hi");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_file", { path: "/ws/sub/a.md" });
  });

  it("rejects paths outside the workspace without invoking", async () => {
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"]);
    await expect(api.readFile("../outside.md")).rejects.toThrow(/outside the workspace/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("lists workspace markdown files", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: ["/ws/a.md"],
      status: { truncated: false, reason: null, limit: null },
    });
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"]);

    await expect(api.listFiles()).resolves.toEqual(["/ws/a.md"]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("list_markdown_files", { path: "/ws" });
  });

  it("tracks a root that changes between calls", async () => {
    let root = "/ws-one";
    const api = createWorkspaceApi(() => root, ["workspace:read"]);
    await api.readFile("a.md");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("read_file", { path: "/ws-one/a.md" });

    root = "/ws-two";
    await api.readFile("a.md");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("read_file", { path: "/ws-two/a.md" });
  });

  it("names the workspace root, or null when none is open", () => {
    expect(createWorkspaceApi(() => "/ws", ["workspace:read"]).getRoot()).toBe("/ws");
    expect(createWorkspaceApi(() => null, ["workspace:read"]).getRoot()).toBeNull();
  });

  it("keeps the root and its changes from a plugin without workspace:read", () => {
    const api = createWorkspaceApi(() => "/ws", []);
    expect(() => api.getRoot()).toThrow(/workspace:read/);
    expect(() => api.onChange(() => {})).toThrow(/workspace:read/);
  });

  it("tells a listener when the workspace changes, until it is removed", () => {
    setPluginAppState({ workspaceRoot: "/ws", activeDocument: null, snapshot: EMPTY_SNAPSHOT });
    const listener = vi.fn();
    const stop = createWorkspaceApi(() => "/ws", ["workspace:read"]).onChange(listener);

    setPluginAppState({ ...pluginAppState(), workspaceRoot: "/other" });
    expect(listener).toHaveBeenCalledOnce();

    stop();
    setPluginAppState({ ...pluginAppState(), workspaceRoot: null });
    expect(listener).toHaveBeenCalledOnce();
  });
});
