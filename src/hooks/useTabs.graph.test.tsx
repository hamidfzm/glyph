import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGraphView, loadGraphView, saveGraphView } from "@/lib/graphViewStore";
import type { ScanStatus } from "@/lib/workspaceScan";
import { getWorkspaceSession } from "@/lib/workspaceSession";
import { defaultOptions, makeInvoker, resetTabsMocks, vaultSnapshot } from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

beforeEach(resetTabsMocks);

afterEach(() => {
  vi.restoreAllMocks();
  clearGraphView("/p/ws");
});

describe("useTabs graph tabs", () => {
  async function openWorkspace(over: Partial<Parameters<typeof useTabs>[0]> = {}) {
    const { result } = renderHook(() => useTabs(defaultOptions(over)));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    return result;
  }

  it("openGraph creates and activates a graph tab for the workspace", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    expect(result.current.tabs.map((t) => t.kind)).toEqual(["graph"]);
    expect(result.current.activeTab?.kind).toBe("graph");
    expect(result.current.activeTab?.kind === "graph" ? result.current.activeTab.root : null).toBe(
      "/p/ws",
    );
  });

  it("openGraph re-activates the existing graph tab instead of duplicating", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    const graphId = result.current.activeTabId;
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });
    expect(result.current.activeTab?.kind).toBe("file");
    act(() => result.current.openGraph());
    expect(result.current.tabs.filter((t) => t.kind === "graph")).toHaveLength(1);
    expect(result.current.activeTabId).toBe(graphId);
  });

  it("openGraph from an active graph tab keeps it active", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    const graphId = result.current.activeTabId;
    act(() => result.current.openGraph());
    expect(result.current.activeTabId).toBe(graphId);
    expect(result.current.tabs).toHaveLength(1);
  });

  it("openGraph is a no-op without an open workspace", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    act(() => result.current.openGraph());
    expect(result.current.tabs).toHaveLength(0);
  });

  it("openGraph with an explicit root requires it to match the workspace", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph("/elsewhere"));
    expect(result.current.tabs.filter((t) => t.kind === "graph")).toHaveLength(0);
  });

  it("a graph tab exposes the window-level workspace index", async () => {
    const snapshot = vaultSnapshot(["/p/ws/a.md", "/p/ws/b.md"], {
      graph: {
        nodes: [
          { id: "/p/ws/a.md", label: "a", degree: 1, orphan: false },
          { id: "/p/ws/b.md", label: "b", degree: 1, orphan: false },
        ],
        edges: [{ source: "/p/ws/a.md", target: "/p/ws/b.md" }],
      },
    });
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ vault_refresh: async () => snapshot }) as typeof invoke,
    );
    const result = await openWorkspace();
    await waitFor(() => expect(result.current.workspaceFiles).toHaveLength(2));

    act(() => result.current.openGraph());
    expect(result.current.activeTab?.kind).toBe("graph");
    expect(result.current.workspaceFiles).toEqual(["/p/ws/a.md", "/p/ws/b.md"]);
    expect(result.current.snapshot.graph.edges).toEqual([
      { source: "/p/ws/a.md", target: "/p/ws/b.md" },
    ]);
  });

  it("indexes note metadata on open and drops it on close", async () => {
    const note = {
      path: "/p/ws/a.md",
      title: "A",
      tags: ["work"],
      fields: { status: "draft" },
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        vault_refresh: async () => vaultSnapshot(["/p/ws/a.md"], { notes: [note] }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.snapshot.notes).toEqual([note]));

    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.snapshot.notes).toEqual([]);
  });

  it("a depth-truncated scan surfaces the depth notice", async () => {
    const status: ScanStatus = { truncated: true, reason: "depthLimit", limit: 32 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ vault_refresh: async () => vaultSnapshot([], { status }) }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.snapshot.status).toEqual(status));
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.indexIncompleteDepth", values: { limit: "32" } },
      { persistent: true },
    );
  });

  it("a file-limit truncated scan sets the status and fires a persistent notice", async () => {
    const status: ScanStatus = { truncated: true, reason: "fileLimit", limit: 2 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        vault_refresh: async () => vaultSnapshot(["/p/ws/a.md"], { status }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.snapshot.status).toEqual(status));
    expect(onWorkspaceNotice).toHaveBeenCalledTimes(1);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.indexIncompleteFiles", values: { limit: "2" } },
      { persistent: true },
    );
  });

  it("falls back to a zero limit in the notice when the scan status carries none", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        vault_refresh: async () =>
          vaultSnapshot([], { status: { truncated: true, reason: "fileLimit", limit: null } }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() =>
      expect(onWorkspaceNotice).toHaveBeenCalledWith(
        { key: "notice.indexIncompleteFiles", values: { limit: "0" } },
        { persistent: true },
      ),
    );
  });

  it("switching workspaces re-fires the notice for the new workspace", async () => {
    const status: ScanStatus = { truncated: true, reason: "fileLimit", limit: 10 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ vault_refresh: async () => vaultSnapshot([], { status }) }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/a");
    });
    await waitFor(() => expect(onWorkspaceNotice).toHaveBeenCalledTimes(1));

    // The second workspace truncates identically; the reset on switch means it
    // still notifies.
    await act(async () => {
      await result.current.openFolder("/p/b");
    });
    await waitFor(() => expect(onWorkspaceNotice).toHaveBeenCalledTimes(2));
  });

  it("closeWorkspace resets the index status to complete", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        vault_refresh: async () =>
          vaultSnapshot(["/p/ws/a.md"], {
            status: { truncated: true, reason: "fileLimit", limit: 1 },
          }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await waitFor(() => expect(result.current.snapshot.status.truncated).toBe(true));

    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.snapshot.status.truncated).toBe(false);
  });

  it("closeWorkspace closes the graph tab and drops its view state", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    saveGraphView("/p/ws", { autoFit: false });
    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
    expect(loadGraphView("/p/ws")).toBeUndefined();
  });

  it("closing the graph tab keeps the workspace open and forgets the view", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    const graphId = result.current.activeTabId as string;
    saveGraphView("/p/ws", { autoFit: false });
    await act(async () => {
      await result.current.closeTab(graphId);
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.workspace?.root).toBe("/p/ws");
    // Reopening from the menu must start auto-fit, not a stale camera.
    expect(loadGraphView("/p/ws")).toBeUndefined();
  });

  it("persists graph tabs after the workspace entry and restores them", async () => {
    const onSettingsChange = vi.fn();
    const result = await openWorkspace({ onSettingsChange });
    act(() => result.current.openGraph());
    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      const last = calls[calls.length - 1]?.[1];
      // The global key keeps only the pointer; the graph tab is snapshot state.
      expect(last).toEqual([expect.objectContaining({ kind: "folder", path: "/p/ws" })]);
    });
    await waitFor(async () => {
      const session = await getWorkspaceSession("/p/ws");
      expect(session?.tabs).toContainEqual({ kind: "graph", path: "/p/ws" });
    });

    // Restore from that persisted state: workspace first, then its graph tab.
    const { result: restored } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/p/ws" },
            { kind: "graph", path: "/p/ws" },
          ],
          activeTabPath: "/p/ws",
        }),
      ),
    );
    await waitFor(() => expect(restored.current.initializing).toBe(false));
    await waitFor(() => expect(restored.current.tabs.map((t) => t.kind)).toEqual(["graph"]));
    expect(restored.current.workspace?.root).toBe("/p/ws");
    expect(restored.current.activeTab?.kind).toBe("graph");
  });

  it("skips restoring a graph tab when no workspace entry is present", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [{ kind: "graph", path: "/p/ws" }],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.workspace).toBeNull();
  });

  it("skips restoring a graph tab whose root doesn't match the workspace", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/p/ws" },
            { kind: "graph", path: "/p/other" },
          ],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
  });
});
