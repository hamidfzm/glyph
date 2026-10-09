import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import { setPluginAppState } from "./appState";
import { createVaultApi } from "./vaultApi";

const READ = ["workspace:read"];

const indexed: VaultSnapshot = {
  ...EMPTY_SNAPSHOT,
  files: ["/ws/a.md", "/ws/b.md"],
  graph: {
    nodes: [{ id: "/ws/a.md", label: "a", degree: 1, orphan: false }],
    edges: [{ source: "/ws/a.md", target: "/ws/b.md" }],
  },
  tagCounts: [{ tag: "work", count: 2 }],
};

function mirror(snapshot: VaultSnapshot) {
  setPluginAppState({ workspaceRoot: "/ws", activeDocument: null, snapshot });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  mirror(indexed);
});

describe("createVaultApi", () => {
  it("refuses every query without the workspace:read permission", async () => {
    const api = createVaultApi(() => "/ws", []);
    await expect(api.graph()).rejects.toThrow(/workspace:read/);
    await expect(api.tags()).rejects.toThrow(/workspace:read/);
    await expect(api.backlinks("/ws/a.md")).rejects.toThrow(/workspace:read/);
    await expect(api.pathsWithTag("work")).rejects.toThrow(/workspace:read/);
    await expect(api.status()).rejects.toThrow(/workspace:read/);
    expect(() => api.onChange(() => {})).toThrow(/workspace:read/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses every query when no workspace is open", async () => {
    const api = createVaultApi(() => null, READ);
    await expect(api.graph()).rejects.toThrow(/no workspace/);
    await expect(api.tags()).rejects.toThrow(/no workspace/);
    await expect(api.backlinks("/ws/a.md")).rejects.toThrow(/no workspace/);
    await expect(api.pathsWithTag("work")).rejects.toThrow(/no workspace/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("answers the graph and tag counts from the snapshot the app holds", async () => {
    const api = createVaultApi(() => "/ws", READ);
    await expect(api.graph()).resolves.toEqual(indexed.graph);
    await expect(api.tags()).resolves.toEqual(indexed.tagCounts);
    expect(invoke).not.toHaveBeenCalled();
  });

  // The app draws from the same snapshot, and a force layout rewrites the
  // edges it is given in place.
  it("hands out copies, so a plugin cannot change what the app renders", async () => {
    const api = createVaultApi(() => "/ws", READ);
    const graph = await api.graph();
    graph.nodes.pop();
    graph.edges[0].source = "rewritten";
    const tags = await api.tags();
    tags[0].count = 99;
    tags.push({ tag: "phantom", count: 1 });

    expect(indexed.graph.nodes).toHaveLength(1);
    expect(indexed.graph.edges[0].source).toBe("/ws/a.md");
    expect(indexed.tagCounts).toEqual([{ tag: "work", count: 2 }]);
  });

  it("says whether the index covers the whole workspace", async () => {
    const api = createVaultApi(() => "/ws", READ);
    await expect(api.status()).resolves.toEqual({ truncated: false });

    mirror({ ...indexed, status: { truncated: true, reason: "fileLimit", limit: 5000 } });
    await expect(api.status()).resolves.toEqual({ truncated: true });
  });

  it("asks the index for a note's backlinks", async () => {
    const rows = [{ source: "/ws/b.md", line: 3, snippet: "see [[a]]" }];
    vi.mocked(invoke).mockResolvedValue(rows);
    const api = createVaultApi(() => "/ws", READ);

    await expect(api.backlinks("/ws/a.md")).resolves.toEqual(rows);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("vault_backlinks", {
      root: "/ws",
      path: "/ws/a.md",
    });
  });

  it("asks the index for the files carrying a tag", async () => {
    vi.mocked(invoke).mockResolvedValue(["/ws/a.md"]);
    const api = createVaultApi(() => "/ws", READ);

    await expect(api.pathsWithTag("work")).resolves.toEqual(["/ws/a.md"]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("vault_paths_with_tag", {
      root: "/ws",
      tag: "work",
    });
  });

  it("answers nothing, without asking, while the index is empty", async () => {
    mirror(EMPTY_SNAPSHOT);
    const api = createVaultApi(() => "/ws", READ);
    await expect(api.backlinks("/ws/a.md")).resolves.toEqual([]);
    await expect(api.pathsWithTag("work")).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes on the backend's refusal", async () => {
    vi.mocked(invoke).mockRejectedValue("workspace not granted");
    const api = createVaultApi(() => "/ws", READ);
    await expect(api.backlinks("/ws/a.md")).rejects.toBe("workspace not granted");
  });

  it("tells a listener when the index changes, until it is removed", () => {
    const api = createVaultApi(() => "/ws", READ);
    const listener = vi.fn();
    const stop = api.onChange(listener);

    mirror({ ...indexed });
    expect(listener).toHaveBeenCalledOnce();

    stop();
    mirror({ ...indexed });
    expect(listener).toHaveBeenCalledOnce();
  });
});
