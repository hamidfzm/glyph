import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCliExportRequest, resetCliExportRequestCache } from "@/lib/cliExport";
import { registerFileType } from "@/lib/plugins/fileTypes";
import { getWorkspaceSession } from "@/lib/workspaceSession";
import { defaultOptions, makeInvoker, resetTabsMocks } from "@/test/tabsHarness";
import { useTabs } from "./useTabs";
import { RESTORE_PLUGIN_WAIT_MS } from "./useTabsSession";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

beforeEach(() => {
  resetTabsMocks();
  resetCliExportRequestCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTabs initialization", () => {
  it("ends up with no tabs and no workspace when nothing is provided", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.workspace).toBeNull();
  });

  describe("waiting for plugins before a saved-session restore", () => {
    const tabPaths = (tabs: ReturnType<typeof useTabs>["tabs"]) =>
      tabs.map((tab) => (tab.kind === "file" ? tab.file.path : ""));

    it("restores a plugin file type's tab once plugins are ready, not before", async () => {
      // Opened before its plugin registers, the tab would be refused and the
      // next session save would drop it.
      const options = { ...defaultOptions(), openTabs: ["/p/seq.puml"], pluginsReady: false };
      const { result, rerender } = renderHook((props) => useTabs(props), { initialProps: options });

      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(result.current.initializing).toBe(true);
      expect(result.current.tabs).toEqual([]);

      const dispose = registerFileType({ extensions: ["puml"], language: "plantuml" });
      try {
        rerender({ ...options, pluginsReady: true });
        await waitFor(() => expect(result.current.initializing).toBe(false));
        expect(tabPaths(result.current.tabs)).toEqual(["/p/seq.puml"]);
      } finally {
        dispose();
      }
    });

    it("gives up waiting on a plugin that never finishes, and restores the rest", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const options = {
          ...defaultOptions(),
          openTabs: ["/p/a.md"],
          pluginsReady: false,
        };
        const { result } = renderHook(() => useTabs(options));
        await act(() => vi.advanceTimersByTimeAsync(RESTORE_PLUGIN_WAIT_MS));
        await waitFor(() => expect(result.current.initializing).toBe(false));
        expect(tabPaths(result.current.tabs)).toEqual(["/p/a.md"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens a CLI file right away, without waiting for plugins", async () => {
      vi.mocked(invoke).mockImplementation(
        makeInvoker({ get_initial_file: async () => "/p/cli.md" }) as typeof invoke,
      );
      const { result } = renderHook(() =>
        useTabs({ ...defaultOptions(), openTabs: ["/p/old.md"], pluginsReady: false }),
      );
      await waitFor(() => expect(result.current.initializing).toBe(false));
      expect(tabPaths(result.current.tabs)).toEqual(["/p/cli.md"]);
    });

    it("keeps what the user opened while waiting instead of restoring over it", async () => {
      const options = { ...defaultOptions(), openTabs: ["/p/old.md"], pluginsReady: false };
      const { result, rerender } = renderHook((props) => useTabs(props), { initialProps: options });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      await act(async () => {
        await result.current.openFile("/p/new.md");
      });
      rerender({ ...options, pluginsReady: true });
      await waitFor(() => expect(result.current.initializing).toBe(false));
      expect(tabPaths(result.current.tabs)).toEqual(["/p/new.md"]);
    });
  });

  it("opens the initial file from get_initial_file", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        get_initial_file: async () => "/p/cli.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1);
    });
    expect(result.current.tabs[0].kind).toBe("file");
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/cli.md");
      expect(result.current.tabs[0].file.content).toBe("FILE BODY");
    }
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/cli.md" });
  });

  it("opens the initial folder from get_initial_folder and prefers it over initial file", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        get_initial_folder: async () => "/p/workspace",
        get_initial_file: async () => "/p/cli.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.workspace?.root).toBe("/p/workspace");
    });
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/workspace" });
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/cli.md" });
  });

  it("keeps the CLI folder when StrictMode double-invokes the init effect", async () => {
    // Regression: get_initial_folder consumes its value, so the second dev-mode
    // run read None and fell through to session restore, replacing the folder
    // the CLI had just opened.
    let folderReads = 0;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        get_initial_folder: async () => {
          folderReads += 1;
          return folderReads === 1 ? "/p/cli-workspace" : null;
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(
      () =>
        useTabs(
          defaultOptions({
            openTabs: [{ kind: "folder" as const, path: "/p/old-session" }],
          }),
        ),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.workspace?.root).toBe("/p/cli-workspace");
    expect(invoke).not.toHaveBeenCalledWith("watch_directory", { path: "/p/old-session" });
  });

  it("restores legacy string[] open tabs", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: ["/p/a.md", "/p/b.md"],
          activeTabPath: "/p/b.md",
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });
    const paths = result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : "(graph)"));
    expect(paths).toEqual(["/p/a.md", "/p/b.md"]);
    expect(result.current.activeTab?.kind).toBe("file");
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/b.md");
    }
  });

  it("restores a folder entry as the workspace and file entries as tabs", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/p/ws", expanded: [] },
            { kind: "file", path: "/p/note.md" },
          ],
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.workspace?.root).toBe("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].kind).toBe("file");
  });

  it("restores a legacy folder entry's inline filePath as a file tab", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [{ kind: "folder", path: "/p/ws", filePath: "/p/ws/note.md" }],
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.workspace?.root).toBe("/p/ws");
    });
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/note.md");
    }
  });

  it("skips extra legacy folder entries beyond the first", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: [
            { kind: "folder", path: "/p/a" },
            { kind: "folder", path: "/p/b" },
          ],
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.workspace?.root).toBe("/p/a");
    expect(invoke).not.toHaveBeenCalledWith("watch_directory", { path: "/p/b" });
  });

  it("falls back to recent[0] when reopenLastFile is true", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          reopenLastFile: true,
          recentFiles: ["/p/last.md"],
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/last.md");
    }
  });

  it("swallows init command failures and still finishes initializing", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        get_initial_folder: async () => {
          throw new Error("ipc broke");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.workspace).toBeNull();
  });
});

describe("useTabs persistence", () => {
  it("persists only the workspace pointer and loose tabs to the global key", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });
    await act(async () => {
      await result.current.openFile("/elsewhere/loose.md");
    });

    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      const last = calls[calls.length - 1]?.[1];
      // Exact shapes: a bare pointer for the workspace (its tabs and expanded
      // dirs live in the per-workspace snapshot), then loose files only.
      expect(last).toEqual([
        { kind: "folder", path: "/p/ws" },
        { kind: "file", path: "/elsewhere/loose.md" },
      ]);
    });
    const activeCalls = onSettingsChange.mock.calls.filter(
      (c) => c[0] === "behavior.activeTabPath",
    );
    expect(activeCalls[activeCalls.length - 1]?.[1]).toBe("/elsewhere/loose.md");

    // The workspace's own snapshot holds the internal tab and expansion state.
    const session = await getWorkspaceSession("/p/ws");
    expect(session?.tabs).toEqual([{ kind: "file", path: "/p/ws/note.md" }]);
    expect(session?.expanded).toEqual(["/p/ws/sub"]);
  });

  it("persists an empty list and an empty active path when nothing is open", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith("behavior.openTabs", []);
      expect(onSettingsChange).toHaveBeenCalledWith("behavior.activeTabPath", "");
    });
  });
});

describe("useTabs multi-window", () => {
  type Injectable = { __GLYPH_OPEN__?: unknown; __GLYPH_PRIMARY__?: unknown };
  afterEach(() => {
    const g = window as unknown as Injectable;
    g.__GLYPH_OPEN__ = undefined;
    g.__GLYPH_PRIMARY__ = undefined;
  });

  it("a spawned window adopts its injected folder and skips session restore", async () => {
    const g = window as unknown as Injectable;
    g.__GLYPH_OPEN__ = { kind: "folder", path: "/p/spawned" };
    g.__GLYPH_PRIMARY__ = false;
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onSettingsChange,
          // Would be restored on a primary window; the spawned window ignores it.
          openTabs: [{ kind: "folder", path: "/p/other" }] as never,
          activeTabPath: "/p/other",
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    expect(result.current.workspace?.root).toBe("/p/spawned");
    // Secondary windows are ephemeral: they never persist the open-tabs session.
    await act(async () => {});
    expect(onSettingsChange.mock.calls.some((c) => c[0] === "behavior.openTabs")).toBe(false);
  });

  it("a spawned window can adopt an injected single file", async () => {
    const g = window as unknown as Injectable;
    g.__GLYPH_OPEN__ = { kind: "file", path: "/p/loose.md" };
    g.__GLYPH_PRIMARY__ = false;
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    expect(
      result.current.tabs.some((t) => t.kind === "file" && t.file.path === "/p/loose.md"),
    ).toBe(true);
  });

  it("the primary window still persists the session", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await waitFor(() =>
      expect(onSettingsChange.mock.calls.some((c) => c[0] === "behavior.openTabs")).toBe(true),
    );
  });

  it("a headless export leaves the saved session and recent files alone", async () => {
    // `glyph export notes.md --format pdf` opens the document like any other tab, but
    // it is a renderer, not a session: writing it back would replace the tabs
    // the user has open in the interactive window it is racing.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        get_cli_export: async () => ({
          input: "/p/a.md",
          format: "pdf",
          output: "/p/a.pdf",
        }),
      }) as typeof invoke,
    );
    await getCliExportRequest();

    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    expect(result.current.tabs).toHaveLength(1);
    const written = onSettingsChange.mock.calls.map((c) => c[0]);
    expect(written).not.toContain("behavior.openTabs");
    expect(written).not.toContain("behavior.activeTabPath");
    expect(written).not.toContain("behavior.recentFiles");
  });
});
