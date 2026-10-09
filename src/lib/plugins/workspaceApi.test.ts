import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { pluginAppState, setPluginAppState } from "./appState";
import { createWorkspaceApi } from "./workspaceApi";

const PLUGIN = "com.x.demo";
const READ_WRITE = ["workspace:read", "workspace:write"];

describe("createWorkspaceApi", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("rejects every call without the workspace:read permission", async () => {
    const api = createWorkspaceApi(() => "/ws", [], PLUGIN);
    await expect(api.readFile("a.md")).rejects.toThrow(/workspace:read/);
    await expect(api.listFiles()).rejects.toThrow(/workspace:read/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("rejects when no workspace is open", async () => {
    const api = createWorkspaceApi(() => null, ["workspace:read"], PLUGIN);
    await expect(api.readFile("a.md")).rejects.toThrow(/no workspace/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("reads a workspace-relative file through the Rust command", async () => {
    vi.mocked(invoke).mockResolvedValue("# hi");
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN);

    await expect(api.readFile("sub/a.md")).resolves.toBe("# hi");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_file", { path: "/ws/sub/a.md" });
  });

  it("rejects paths outside the workspace without invoking", async () => {
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN);
    await expect(api.readFile("../outside.md")).rejects.toThrow(/outside the workspace/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("lists workspace markdown files", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: ["/ws/a.md"],
      status: { truncated: false, reason: null, limit: null },
    });
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN);

    await expect(api.listFiles()).resolves.toEqual(["/ws/a.md"]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("list_markdown_files", { path: "/ws" });
  });

  it("tracks a root that changes between calls", async () => {
    let root = "/ws-one";
    const api = createWorkspaceApi(() => root, ["workspace:read"], PLUGIN);
    await api.readFile("a.md");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("read_file", { path: "/ws-one/a.md" });

    root = "/ws-two";
    await api.readFile("a.md");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("read_file", { path: "/ws-two/a.md" });
  });

  it("names the workspace root, or null when none is open", () => {
    expect(createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN).getRoot()).toBe("/ws");
    expect(createWorkspaceApi(() => null, ["workspace:read"], PLUGIN).getRoot()).toBeNull();
  });

  it("keeps the root and its changes from a plugin without workspace:read", () => {
    const api = createWorkspaceApi(() => "/ws", [], PLUGIN);
    expect(() => api.getRoot()).toThrow(/workspace:read/);
    expect(() => api.onChange(() => {})).toThrow(/workspace:read/);
  });

  it("tells a listener when the workspace changes, until it is removed", () => {
    setPluginAppState({ workspaceRoot: "/ws", activeDocument: null, snapshot: EMPTY_SNAPSHOT });
    const listener = vi.fn();
    const stop = createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN).onChange(listener);

    setPluginAppState({ ...pluginAppState(), workspaceRoot: "/other" });
    expect(listener).toHaveBeenCalledOnce();

    stop();
    setPluginAppState({ ...pluginAppState(), workspaceRoot: null });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("creates a file through the create-only command, by its forward-slash path", async () => {
    const created = { path: "/ws/daily/2026-10-08.md", created: true };
    vi.mocked(invoke).mockResolvedValue(created);
    const api = createWorkspaceApi(() => "/ws", ["workspace:write"], PLUGIN);

    await expect(api.createFile("daily\\2026-10-08.md", "# Today")).resolves.toEqual(created);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_workspace_file", {
      root: "/ws",
      path: "daily/2026-10-08.md",
      content: "# Today",
    });
  });

  it("creates an empty file when given no content", async () => {
    const api = createWorkspaceApi(() => "/ws", ["workspace:write"], PLUGIN);
    await api.createFile("note.md");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_workspace_file", {
      root: "/ws",
      path: "note.md",
      content: "",
    });
  });

  it("refuses to write for a plugin that only declared workspace:read", async () => {
    const api = createWorkspaceApi(() => "/ws", ["workspace:read"], PLUGIN);
    await expect(api.createFile("note.md")).rejects.toThrow(/workspace:write/);
    await expect(api.setSettings({ folder: "x" })).rejects.toThrow(/workspace:write/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("refuses to create a file outside the workspace, or without one open", async () => {
    const api = createWorkspaceApi(() => "/ws", READ_WRITE, PLUGIN);
    await expect(api.createFile("../escape.md")).rejects.toThrow(/outside the workspace/);
    await expect(api.createFile("/etc/passwd")).rejects.toThrow(/outside the workspace/);

    const closed = createWorkspaceApi(() => null, READ_WRITE, PLUGIN);
    await expect(closed.createFile("note.md")).rejects.toThrow(/no workspace/);
    await expect(closed.getSettings()).rejects.toThrow(/no workspace/);
    await expect(closed.setSettings({})).rejects.toThrow(/no workspace/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("reads and replaces the plugin's own settings for the workspace", async () => {
    vi.mocked(invoke).mockResolvedValue({ folder: "journal" });
    const api = createWorkspaceApi(() => "/ws", READ_WRITE, PLUGIN);

    await expect(api.getSettings()).resolves.toEqual({ folder: "journal" });
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("workspace_get_plugin_settings", {
      workspaceRoot: "/ws",
      pluginId: PLUGIN,
    });

    await api.setSettings({ folder: "daily" });
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("workspace_set_plugin_settings", {
      workspaceRoot: "/ws",
      pluginId: PLUGIN,
      settings: { folder: "daily" },
    });
  });

  it("keeps a workspace's settings from a plugin without workspace:read", async () => {
    const api = createWorkspaceApi(() => "/ws", ["workspace:write"], PLUGIN);
    await expect(api.getSettings()).rejects.toThrow(/workspace:read/);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
