import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultOptions,
  fileScan,
  makeInvoker,
  metadataScan,
  resetTabsMocks,
  wikilinkScan,
} from "@/test/tabsHarness";
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md", "/p/ws/b.md"]),
        scan_wikilinks: async () =>
          wikilinkScan([{ source: "/p/ws/a.md", target: "b", line: 1, snippet: "[[b]]" }]),
      }) as typeof invoke,
    );
    const result = await openWorkspace();
    await waitFor(() => expect(result.current.workspaceFiles).toHaveLength(2));

    act(() => result.current.openGraph());
    expect(result.current.activeTab?.kind).toBe("graph");
    expect(result.current.workspaceFiles).toEqual(["/p/ws/a.md", "/p/ws/b.md"]);
    expect(result.current.wikilinkRefs).toEqual([
      { source: "/p/ws/a.md", target: "b", line: 1, snippet: "[[b]]" },
    ]);
  });

  it("scans workspace metadata on open and drops it on close", async () => {
    const entry = { path: "/p/ws/a.md", frontmatter: "---\nstatus: draft\n---\n", tags: ["work"] };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md"]),
        scan_metadata: async () => metadataScan([entry]),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.metadataEntries).toEqual([entry]));

    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.metadataEntries).toEqual([]);
  });

  it("a truncated metadata scan surfaces the incomplete-index notice", async () => {
    const truncated = { truncated: true, reason: "depthLimit", limit: 32 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        scan_metadata: async () => ({ files: [], status: truncated }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.indexStatus.metadata).toEqual(truncated));
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.indexIncompleteDepth", values: { limit: "32" } },
      { persistent: true },
    );
  });

  it("a truncated file scan sets indexStatus and fires a persistent notice", async () => {
    const truncated = { truncated: true, reason: "fileLimit", limit: 2 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ({ files: ["/p/ws/a.md"], status: truncated }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.indexStatus.files).toEqual(truncated));
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.indexIncompleteFiles", values: { limit: "2" } },
      { persistent: true },
    );
  });

  it("a depth-truncated wikilink scan surfaces the depth notice", async () => {
    const truncated = { truncated: true, reason: "depthLimit", limit: 32 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        scan_wikilinks: async () => ({ refs: [], status: truncated }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.indexStatus.wikilinks).toEqual(truncated));
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.indexIncompleteDepth", values: { limit: "32" } },
      { persistent: true },
    );
  });

  it("falls back to a zero limit in the notice when the scan status carries none", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ({
          files: [],
          status: { truncated: true, reason: "fileLimit", limit: null },
        }),
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

  it("fires the notice once when both indexes report the same truncation", async () => {
    const truncated = { truncated: true, reason: "fileLimit", limit: 10 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ({ files: [], status: truncated }),
        scan_wikilinks: async () => ({ refs: [], status: truncated }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await waitFor(() => expect(result.current.indexStatus.wikilinks).toEqual(truncated));
    expect(onWorkspaceNotice).toHaveBeenCalledTimes(1);
  });

  it("switching workspaces re-fires the notice for the new workspace", async () => {
    const truncated = { truncated: true, reason: "fileLimit", limit: 10 };
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ({ files: [], status: truncated }),
      }) as typeof invoke,
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
        list_markdown_files: async () => ({
          files: ["/p/ws/a.md"],
          status: { truncated: true, reason: "fileLimit", limit: 1 },
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await waitFor(() => expect(result.current.indexStatus.files.truncated).toBe(true));

    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.indexStatus.files.truncated).toBe(false);
    expect(result.current.indexStatus.wikilinks.truncated).toBe(false);
  });

  it("closeWorkspace closes the graph tab", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    await act(async () => {
      await result.current.closeWorkspace();
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it("closing the graph tab keeps the workspace open", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    const graphId = result.current.activeTabId as string;
    await act(async () => {
      await result.current.closeTab(graphId);
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.workspace?.root).toBe("/p/ws");
  });

  it("persists graph tabs after the workspace entry and restores them", async () => {
    const onSettingsChange = vi.fn();
    const result = await openWorkspace({ onSettingsChange });
    act(() => result.current.openGraph());
    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      const last = calls[calls.length - 1]?.[1];
      expect(last).toEqual([
        expect.objectContaining({ kind: "folder", path: "/p/ws" }),
        { kind: "graph", path: "/p/ws" },
      ]);
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
