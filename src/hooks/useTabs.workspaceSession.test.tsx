import { invoke } from "@tauri-apps/api/core";
import { getStore } from "@tauri-apps/plugin-store";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCliExportProcess } from "@/lib/cliExport";
import { registerSessionSidebarBridge, registerSessionZoomBridge } from "@/lib/sessionUiBridge";
import type { WorkspaceSession } from "@/lib/workspaceSession";
import { getWorkspaceSession, saveWorkspaceSession } from "@/lib/workspaceSession";
import { deferred } from "@/test/deferred";
import { defaultOptions, type Invoker, makeInvoker, resetTabsMocks } from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));
vi.mock("@/lib/cliExport", () => ({ isCliExportProcess: vi.fn(() => false) }));

beforeEach(resetTabsMocks);

afterEach(() => {
  registerSessionZoomBridge(null);
  registerSessionSidebarBridge(null);
  vi.restoreAllMocks();
});

function snapshot(over: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    tabs: [],
    activeTabPath: "",
    expanded: [],
    scroll: {},
    zoom: {},
    savedAt: 1,
    ...over,
  };
}

type Hook = { current: ReturnType<typeof useTabs> };

async function ready(result: Hook) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
}

function filePaths(result: Hook) {
  return result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : `graph:${t.root}`));
}

describe("useTabs per-workspace sessions", () => {
  it("switching workspaces and back restores the first workspace's tabs, active tab, and scroll", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    await act(async () => {
      await result.current.openFolder("/a");
    });
    await act(async () => {
      await result.current.openFile("/a/one.md");
    });
    await act(async () => {
      await result.current.openFile("/a/two.md");
    });
    act(() => {
      const one = result.current.tabs.find((t) => t.kind === "file" && t.file.path === "/a/one.md");
      if (one) result.current.setActiveTab(one.id);
    });
    // Scroll the active tab; capture must pick the live value up.
    act(() => {
      result.current.saveScrollPosition(120);
    });

    await act(async () => {
      await result.current.openFolder("/b");
    });
    expect(filePaths(result)).toEqual([]);

    await act(async () => {
      await result.current.openFolder("/a");
    });

    expect(filePaths(result)).toEqual(["/a/one.md", "/a/two.md"]);
    const one = result.current.tabs.find((t) => t.kind === "file" && t.file.path === "/a/one.md");
    expect(result.current.activeTabId).toBe(one?.id);
    expect(one?.kind === "file" ? one.file.scrollTop : 0).toBe(120);

    // Scrolling back to the very top is a position too: capture must not
    // resurrect the old offset from stale tab state.
    act(() => {
      result.current.saveScrollPosition(0);
    });
    await act(async () => {
      await result.current.openFolder("/b");
    });
    await act(async () => {
      await result.current.openFolder("/a");
    });
    const oneAgain = result.current.tabs.find(
      (t) => t.kind === "file" && t.file.path === "/a/one.md",
    );
    expect(oneAgain?.kind === "file" ? oneAgain.file.scrollTop : -1).toBe(0);
  });

  it("restoring a workspace leaves Recent Files and the remembered last file alone", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/a");
    });
    await act(async () => {
      await result.current.openFile("/a/one.md");
    });

    await act(async () => {
      await result.current.openFolder("/b");
    });
    onSettingsChange.mockClear();
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await result.current.openFolder("/a");
    });

    expect(filePaths(result)).toEqual(["/a/one.md"]);
    const recentWrites = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.recentFiles");
    expect(recentWrites).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("workspace_set_last_file", expect.anything());
  });

  it("a folder refused at launch reopens its legacy entries as loose tabs", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: "/parent",
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/ws" },
            { kind: "file", path: "/ws/in.md" },
          ],
        }),
      ),
    );
    await ready(result);

    expect(result.current.workspace).toBeNull();
    expect(filePaths(result)).toEqual(["/ws/in.md"]);
  });

  it("a snapshot without sidebar state resyncs the panels instead of leaking the previous workspace's", async () => {
    const applyVisibility = vi.fn();
    registerSessionSidebarBridge({
      visibility: () => ({ filesSidebarVisible: true, outlineSidebarVisible: true }),
      applyVisibility,
    });
    const seedZoom = vi.fn();
    registerSessionZoomBridge({ zoomByTabId: () => ({}), seedZoom });
    saveWorkspaceSession("/a", snapshot({ tabs: [] }));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    await act(async () => {
      await result.current.openFolder("/a");
    });

    expect(applyVisibility).toHaveBeenCalledWith(null);
    // Nothing to seed: an empty snapshot never calls into the zoom bridge.
    expect(seedZoom).not.toHaveBeenCalled();
  });

  it("a workspace closed with no tabs restores empty: empty is not absent", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ({ files: ["/a/auto.md"], status: "complete" }),
      }) as typeof invoke,
    );
    saveWorkspaceSession("/a", snapshot());
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    await act(async () => {
      await result.current.openFolder("/a");
    });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("restores graph tabs and zoom through the bridges, and applies sidebar visibility", async () => {
    const seedZoom = vi.fn();
    const liveZoom: Record<string, number> = {};
    registerSessionZoomBridge({ zoomByTabId: () => liveZoom, seedZoom });
    const applyVisibility = vi.fn();
    registerSessionSidebarBridge({
      visibility: () => ({ filesSidebarVisible: true, outlineSidebarVisible: true }),
      applyVisibility,
    });
    saveWorkspaceSession("/a", {
      tabs: [
        { kind: "file", path: "/a/one.md" },
        { kind: "file", path: "/a/two.md" },
        { kind: "graph", path: "/a" },
      ],
      activeTabPath: "/a",
      expanded: [],
      scroll: {},
      // 9 clamps to the max, the ghost never opens, and a tampered
      // non-number factor is dropped rather than seeded.
      zoom: { "/a/one.md": 9, "/a/ghost.md": 2, "/a/two.md": "nope" as unknown as number },
      sidebar: { filesSidebarVisible: false, outlineSidebarVisible: true },
      savedAt: 1,
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    await act(async () => {
      await result.current.openFolder("/a");
    });

    expect(filePaths(result)).toEqual(["/a/one.md", "/a/two.md", "graph:/a"]);
    expect(result.current.activeTab?.kind).toBe("graph");
    const one = result.current.tabs.find((t) => t.kind === "file");
    // Stored factors are clamped (the store file is user-editable).
    expect(seedZoom).toHaveBeenCalledWith({ [one?.id ?? ""]: 3 });
    expect(applyVisibility).toHaveBeenCalledWith({
      filesSidebarVisible: false,
      outlineSidebarVisible: true,
    });
  });

  it("a surviving tab's live zoom beats the snapshot's stored factor", async () => {
    const seedZoom = vi.fn();
    const liveZoom: Record<string, number> = {};
    registerSessionZoomBridge({ zoomByTabId: () => liveZoom, seedZoom });
    saveWorkspaceSession("/a", {
      tabs: [
        { kind: "file", path: "/a/one.md" },
        { kind: "file", path: "/a/two.md" },
      ],
      activeTabPath: "",
      expanded: [],
      scroll: {},
      zoom: { "/a/one.md": 1.5, "/a/two.md": 2 },
      savedAt: 1,
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    // one.md is already open (loose) with its own live zoom before the
    // workspace opens; restore must not overwrite it.
    await act(async () => {
      await result.current.openFile("/a/one.md");
    });
    const oneId = result.current.tabs.find((t) => t.kind === "file")?.id ?? "";
    liveZoom[oneId] = 1.2;

    await act(async () => {
      await result.current.openFolder("/a");
    });

    const two = result.current.tabs.find((t) => t.kind === "file" && t.file.path === "/a/two.md");
    expect(seedZoom).toHaveBeenCalledWith({ [two?.id ?? ""]: 2 });
  });

  it("an abandoned restore never unwatches a path its successor now owns", async () => {
    const gate = deferred<string>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: ((_cmd, args) =>
          String(args?.path) === "/a/one.md" && !gateResolved
            ? gate.promise
            : Promise.resolve("BODY")) as Invoker,
      }) as typeof invoke,
    );
    let gateResolved = false;
    saveWorkspaceSession("/a", snapshot({ tabs: [{ kind: "file", path: "/a/one.md" }] }));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    let firstOpen: Promise<void> = Promise.resolve();
    await act(async () => {
      firstOpen = result.current.openFolder("/a");
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.openFolder("/b");
    });
    // The same file reopens as a loose tab under /b before the abandoned
    // restore's read resolves; the fresh watch belongs to this tab now.
    await act(async () => {
      gateResolved = true;
      await result.current.openFile("/a/one.md");
    });
    await act(async () => {
      gate.resolve("LATE BODY");
      await firstOpen;
    });

    expect(filePaths(result)).toEqual(["/a/one.md"]);
    const unwatches = vi
      .mocked(invoke)
      .mock.calls.filter(
        (c) => c[0] === "unwatch_file" && (c[1] as { path: string }).path === "/a/one.md",
      );
    expect(unwatches).toHaveLength(0);
  });

  it("captures zoom and sidebar visibility into the snapshot through the bridges", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/a");
    });
    await act(async () => {
      await result.current.openFile("/a/one.md");
    });
    const one = result.current.tabs.find((t) => t.kind === "file");
    registerSessionZoomBridge({
      zoomByTabId: () => ({ [one?.id ?? ""]: 2 }),
      seedZoom: vi.fn(),
    });
    registerSessionSidebarBridge({
      visibility: () => ({ filesSidebarVisible: false, outlineSidebarVisible: false }),
      applyVisibility: vi.fn(),
    });

    await act(async () => {
      await result.current.closeWorkspace();
    });

    const session = await getWorkspaceSession("/a");
    expect(session?.zoom).toEqual({ "/a/one.md": 2 });
    expect(session?.sidebar).toEqual({
      filesSidebarVisible: false,
      outlineSidebarVisible: false,
    });
  });

  it("migrates a legacy global session into the workspace snapshot and opens loose files", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onSettingsChange,
          openTabs: [
            { kind: "folder", path: "/ws", expanded: ["/ws/sub"] },
            { kind: "file", path: "/ws/in.md" },
            { kind: "file", path: "/elsewhere/loose.md" },
          ],
          activeTabPath: "/ws/in.md",
        }),
      ),
    );
    await ready(result);

    expect(filePaths(result)).toEqual(["/ws/in.md", "/elsewhere/loose.md"]);
    expect(result.current.workspace?.root).toBe("/ws");
    expect(result.current.workspace?.expanded.has("/ws/sub")).toBe(true);

    const session = await getWorkspaceSession("/ws");
    expect(session?.tabs).toEqual([{ kind: "file", path: "/ws/in.md" }]);
    expect(session?.expanded).toEqual(["/ws/sub"]);

    // The slimmed global key: pointer plus the loose file only.
    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      expect(calls[calls.length - 1]?.[1]).toEqual([
        { kind: "folder", path: "/ws" },
        { kind: "file", path: "/elsewhere/loose.md" },
      ]);
    });
  });

  it("launch restore prefers an existing snapshot over stale legacy entries", async () => {
    saveWorkspaceSession("/ws", snapshot({ tabs: [{ kind: "file", path: "/ws/kept.md" }] }));
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/ws" },
            { kind: "file", path: "/ws/stale.md" },
          ],
        }),
      ),
    );
    await ready(result);

    expect(filePaths(result)).toEqual(["/ws/kept.md"]);
  });

  it("a secondary window persists its workspace snapshot but never the global key", async () => {
    const g = window as unknown as { __GLYPH_PRIMARY__?: boolean };
    g.__GLYPH_PRIMARY__ = false;
    try {
      const onSettingsChange = vi.fn();
      const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
      await ready(result);
      await act(async () => {
        await result.current.openFolder("/ws");
      });
      await act(async () => {
        await result.current.openFile("/ws/a.md");
      });

      await waitFor(async () => {
        const session = await getWorkspaceSession("/ws");
        expect(session?.tabs).toEqual([{ kind: "file", path: "/ws/a.md" }]);
      });
      const globalWrites = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      expect(globalWrites).toHaveLength(0);
    } finally {
      g.__GLYPH_PRIMARY__ = undefined;
    }
  });

  it("abandons a restore interrupted by another workspace open, keeping the stored snapshot intact", async () => {
    const gate = deferred<string>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: ((_cmd, args) =>
          String(args?.path) === "/a/one.md" ? gate.promise : Promise.resolve("BODY")) as Invoker,
      }) as typeof invoke,
    );
    const seeded = snapshot({
      tabs: [
        { kind: "file", path: "/a/one.md" },
        { kind: "file", path: "/a/two.md" },
      ],
      activeTabPath: "/a/one.md",
      scroll: { "/a/one.md": 50 },
    });
    saveWorkspaceSession("/a", seeded);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    let firstOpen: Promise<void> = Promise.resolve();
    await act(async () => {
      firstOpen = result.current.openFolder("/a");
      // Let the first open reach the blocked read_file, then switch away.
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.openFolder("/b");
      gate.resolve("LATE BODY");
      await firstOpen;
    });

    // The late tab never lands in the new workspace's strip...
    expect(result.current.workspace?.root).toBe("/b");
    expect(filePaths(result)).toEqual([]);
    // ...and workspace /a keeps its good snapshot for the next open.
    const session = await getWorkspaceSession("/a");
    expect(session?.tabs).toEqual(seeded.tabs);
    expect(session?.scroll).toEqual({ "/a/one.md": 50 });
  });

  it("closing the workspace mid-restore skips the capture, keeping the stored snapshot", async () => {
    const gate = deferred<string>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: ((_cmd, args) =>
          String(args?.path) === "/a/one.md" ? gate.promise : Promise.resolve("BODY")) as Invoker,
      }) as typeof invoke,
    );
    const seeded = snapshot({
      tabs: [{ kind: "file", path: "/a/one.md" }],
      activeTabPath: "/a/one.md",
      scroll: { "/a/one.md": 50 },
    });
    saveWorkspaceSession("/a", seeded);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    let open: Promise<void> = Promise.resolve();
    await act(async () => {
      open = result.current.openFolder("/a");
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.closeWorkspace();
      gate.resolve("LATE BODY");
      await open;
    });

    // The half-restored (empty) strip never overwrites the good snapshot.
    expect(result.current.workspace).toBeNull();
    expect(filePaths(result)).toEqual([]);
    const session = await getWorkspaceSession("/a");
    expect(session?.tabs).toEqual(seeded.tabs);
    expect(session?.scroll).toEqual({ "/a/one.md": 50 });
  });

  it("abandons a restore whose scan is outrun by another workspace open", async () => {
    const gate = deferred<{ files: string[]; status: string }>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: ((_cmd, args) =>
          String(args?.path) === "/a"
            ? gate.promise
            : Promise.resolve({ files: [], status: "complete" })) as Invoker,
      }) as typeof invoke,
    );
    saveWorkspaceSession("/a", snapshot({ tabs: [{ kind: "file", path: "/a/one.md" }] }));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    let firstOpen: Promise<void> = Promise.resolve();
    await act(async () => {
      firstOpen = result.current.openFolder("/a");
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.openFolder("/b");
      gate.resolve({ files: ["/a/one.md"], status: "complete" });
      await firstOpen;
    });

    expect(result.current.workspace?.root).toBe("/b");
    expect(filePaths(result)).toEqual([]);
  });

  it("closing the window mid-restore flushes without overwriting the stored snapshot", async () => {
    const gate = deferred<string>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: ((_cmd, args) =>
          String(args?.path) === "/a/one.md" ? gate.promise : Promise.resolve("BODY")) as Invoker,
      }) as typeof invoke,
    );
    const seeded = snapshot({
      tabs: [{ kind: "file", path: "/a/one.md" }],
      activeTabPath: "/a/one.md",
      scroll: { "/a/one.md": 50 },
    });
    saveWorkspaceSession("/a", seeded);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);

    let open: Promise<void> = Promise.resolve();
    await act(async () => {
      open = result.current.openFolder("/a");
      await Promise.resolve();
    });
    // The close-path flush lands while the restore is still blocked on the
    // read: it must skip the capture, not write the half-restored strip.
    await act(async () => {
      await result.current.flushSessionForClose();
    });
    await act(async () => {
      gate.resolve("BODY");
      await open;
    });

    const session = await getWorkspaceSession("/a");
    expect(session?.scroll).toEqual({ "/a/one.md": 50 });
  });

  it("flushSessionForClose captures the live scroll and writes the snapshot to the store", async () => {
    const set = vi.fn(() => Promise.resolve());
    vi.mocked(getStore).mockResolvedValue({
      get: vi.fn(() => Promise.resolve(null)),
      set,
      save: vi.fn(() => Promise.resolve()),
      entries: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() => Promise.resolve(true)),
      length: vi.fn(() => Promise.resolve(0)),
    } as unknown as Awaited<ReturnType<typeof getStore>>);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws");
    });
    await act(async () => {
      await result.current.openFile("/ws/a.md");
    });
    act(() => {
      result.current.saveScrollPosition(77);
    });

    await act(async () => {
      await result.current.flushSessionForClose();
    });

    expect(set).toHaveBeenCalledWith(
      "/ws",
      expect.objectContaining({
        tabs: [{ kind: "file", path: "/ws/a.md" }],
        scroll: { "/ws/a.md": 77 },
      }),
    );
  });

  it("flushSessionForClose without a workspace flushes nothing and resolves", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.flushSessionForClose();
    });
    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
  });

  it("a headless export process never writes workspace snapshots", async () => {
    vi.mocked(isCliExportProcess).mockReturnValue(true);
    try {
      const { result } = renderHook(() => useTabs(defaultOptions()));
      await ready(result);
      await act(async () => {
        await result.current.openFolder("/ws");
      });
      await act(async () => {
        await result.current.openFile("/ws/a.md");
      });
      await act(async () => {
        await result.current.flushSessionForClose();
      });

      await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
    } finally {
      vi.mocked(isCliExportProcess).mockReturnValue(false);
    }
  });
});
