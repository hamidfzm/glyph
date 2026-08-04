import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFiles } from "@/lib/pickers";
import { defaultOptions, type Invoker, makeInvoker, resetTabsMocks } from "@/test/tabsHarness";
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

describe("useTabs command failures", () => {
  it("falls back to empty listings when directory reads and workspace scans fail", async () => {
    // Covers the catch arms of loadDirectory, loadWorkspaceFiles,
    // loadWikilinkRefs, and loadMetadata: each logs and degrades to an empty
    // result so a permission error on one Rust command never breaks the
    // workspace.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = async () => {
      throw new Error("denied");
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: boom,
        list_markdown_files: boom,
        scan_wikilinks: boom,
        scan_metadata: boom,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.nodes.get("/p/ws")).toEqual([]);
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.workspaceFiles).toEqual([]);
    expect(result.current.wikilinkRefs).toEqual([]);
    expect(result.current.metadataEntries).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("openFile logs and opens no tab when the file can't be read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => {
          throw new Error("io error");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/broken.md");
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith("Failed to open file:", expect.anything());
    errorSpy.mockRestore();
  });

  it("openFolder still opens the workspace when watch_directory fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        watch_directory: async () => {
          throw new Error("watcher limit");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(errorSpy).toHaveBeenCalledWith("Failed to watch directory:", expect.anything());
    errorSpy.mockRestore();
  });

  it("toggleTask leaves content untouched and records no history when the write fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeFile = vi.fn(async () => {
      throw new Error("read-only fs");
    });
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [ ] task");
    }
    expect(errorSpy).toHaveBeenCalledWith("Failed to apply edit:", expect.anything());

    // The failed edit must not land on the undo stack, so undo has nothing to
    // replay and never re-attempts the write.
    writeFile.mockClear();
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("useTabs guards and no-ops", () => {
  it("setActiveTab works when no tab was active", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.setActiveTab("ghost");
    });

    expect(result.current.activeTabId).toBe("ghost");
    expect(result.current.activeTab).toBeNull();
  });

  it("closeTab is a no-op for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      await result.current.closeTab("nope");
    });

    expect(result.current.tabs).toHaveLength(1);
  });

  it("saveScrollPosition before any tab is active is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.saveScrollPosition(123);
    });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("toggleTask is a no-op for unknown tabs, graph tabs, and unchanged lines", async () => {
    const writeFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    const graphId = result.current.tabs.find((t) => t.kind === "graph")?.id as string;
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")?.id as string;

    await act(async () => {
      await result.current.toggleTask("nope", 1);
      await result.current.toggleTask(graphId, 1);
      // Line 99 is past the end of the file, so the toggle changes nothing.
      await result.current.toggleTask(fileId, 99);
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("undo and redo stop at the ends of the history stack", async () => {
    const writeFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    // Redo before any edit: the tab has no history at all yet.
    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    // Nothing to redo yet: the toggle only populated the undo stack.
    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenCalledTimes(2);

    // The undo stack is exhausted; a second undo applies nothing.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("undoEdit applies nothing when the tab has been closed", async () => {
    // closeTab drops the per-tab history map entry, but even with a stale id
    // the apply step bails because the tab no longer exists.
    const writeFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.closeTab(tabId);
    });
    await act(async () => {
      await result.current.undoEdit(tabId);
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("undo and redo keep their history entry when the write fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let failWrites = false;
    const writeFile = vi.fn(async () => {
      if (failWrites) throw new Error("read-only fs");
      return undefined;
    });
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    // A failed undo must not pop the entry, so retrying once the disk is
    // writable again still applies it.
    failWrites = true;
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    failWrites = false;
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [ ] task");
    }

    // Same for redo.
    failWrites = true;
    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    failWrites = false;
    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }
    errorSpy.mockRestore();
  });

  it("openFile seeds the recent-files list when none is persisted yet", async () => {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onSettingsChange,
          recentFiles: undefined as unknown as string[],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/first.md");
    });

    expect(onSettingsChange).toHaveBeenCalledWith("behavior.recentFiles", ["/p/first.md"]);
  });

  it("openFileDialog opens a single selected path", async () => {
    vi.mocked(pickFiles).mockResolvedValue(["/p/solo.md"]);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFileDialog();
    });

    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/solo.md");
    }
  });

  it("keeps the last-opened tab active when activeTabPath matches nothing", async () => {
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: ["/p/a.md", "/p/b.md"],
          activeTabPath: "/p/zzz.md",
        }),
      ),
    );
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/b.md");
    }
  });
});
