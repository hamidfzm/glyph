import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "./useTabs";

type Invoker = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function makeInvoker(overrides: Partial<Record<string, Invoker>> = {}): Invoker {
  return async (cmd, args) => {
    const fn = overrides[cmd];
    if (fn) return fn(cmd, args);
    switch (cmd) {
      case "get_initial_file":
      case "get_initial_folder":
        return null;
      case "read_file":
        return "FILE BODY";
      case "get_file_metadata":
        return {
          name:
            String(args?.path ?? "")
              .split("/")
              .pop() ?? "",
          path: String(args?.path ?? ""),
          size: 0,
          modified: 0,
        };
      case "watch_file":
      case "unwatch_file":
      case "watch_directory":
      case "unwatch_directory":
      case "write_file":
        return undefined;
      case "read_directory":
        return [];
      case "list_markdown_files":
        return [];
      case "scan_wikilinks":
        return [];
      default:
        return undefined;
    }
  };
}

function defaultOptions(over: Partial<Parameters<typeof useTabs>[0]> = {}) {
  return {
    reopenLastFile: false,
    openTabs: [] as string[],
    activeTabPath: "",
    recentFiles: [],
    autoReload: false,
    defaultEditorMode: "view" as const,
    onSettingsChange: vi.fn(),
    ...over,
  };
}

function captureListener(
  event: "open-file" | "open-folder" | "file-changed" | "directory-changed",
) {
  const ref: { handler: ((e: { payload: string }) => void) | null } = { handler: null };
  vi.mocked(listen).mockImplementation(((name: string, fn: (e: { payload: string }) => void) => {
    if (name === event) ref.handler = fn;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  return ref;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(makeInvoker() as typeof invoke);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(open).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTabs initialization", () => {
  it("ends up with no tabs when nothing is provided", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
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
      expect(result.current.tabs).toHaveLength(1);
    });
    expect(result.current.tabs[0].kind).toBe("folder");
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/workspace" });
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/cli.md" });
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
    const paths = result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : "(folder)"));
    expect(paths).toEqual(["/p/a.md", "/p/b.md"]);
    expect(result.current.activeTab?.kind).toBe("file");
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/b.md");
    }
  });

  it("restores PersistedTab[] mix of folder and file tabs", async () => {
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
      expect(result.current.tabs).toHaveLength(2);
    });
    expect(result.current.tabs[0].kind).toBe("folder");
    expect(result.current.tabs[1].kind).toBe("file");
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
});

describe("useTabs file operations", () => {
  it("opens a new file tab on openFile", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/new.md");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTab?.id).toBe(result.current.tabs[0].id);
  });

  it("activates the existing tab instead of duplicating", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/x.md");
    });
    await act(async () => {
      await result.current.openFile("/p/y.md");
    });
    await act(async () => {
      await result.current.openFile("/p/x.md");
    });

    expect(result.current.tabs).toHaveLength(2);
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/x.md");
    }
  });

  it("closeTab removes the tab and unwatches the file", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const toClose = result.current.tabs[0].id;
    act(() => {
      result.current.closeTab(toClose);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/a.md" });
  });

  it("closeTab on the active tab advances activeTabId to a neighbor", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const activeId = result.current.activeTabId;
    expect(activeId).toBe(result.current.tabs[1].id);
    act(() => {
      result.current.closeTab(activeId as string);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("setActiveTab switches the active tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const firstId = result.current.tabs[0].id;
    act(() => {
      result.current.setActiveTab(firstId);
    });

    expect(result.current.activeTabId).toBe(firstId);
  });

  it("setTabMode initializes editContent from content the first time", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.setTabMode(tabId, "edit");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.mode).toBe("edit");
      expect(result.current.tabs[0].file.editContent).toBe("FILE BODY");
    }
  });

  it("updateEditContent marks the file dirty and markSaved clears it", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "EDITED");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.dirty).toBe(true);
      expect(result.current.tabs[0].file.editContent).toBe("EDITED");
    }

    act(() => {
      result.current.markSaved(tabId, "EDITED");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.dirty).toBe(false);
      expect(result.current.tabs[0].file.content).toBe("EDITED");
    }
  });

  it("saveScrollPosition + setActiveTab persists scrollTop to the leaving tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    act(() => {
      result.current.saveScrollPosition(420);
    });
    const firstId = result.current.tabs[0].id;
    act(() => {
      result.current.setActiveTab(firstId);
    });

    const second = result.current.tabs[1];
    if (second.kind === "file") {
      expect(second.file.scrollTop).toBe(420);
    }
  });
});

describe("useTabs dialog and events", () => {
  it("openFileDialog opens each selected path", async () => {
    vi.mocked(open).mockResolvedValue(["/p/x.md", "/p/y.md"]);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFileDialog();
    });

    expect(result.current.tabs).toHaveLength(2);
  });

  it("openFileDialog is a no-op when nothing is selected", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFileDialog();
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("opens a folder via openFolder and watches it", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].kind).toBe("folder");
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/ws" });
  });

  it("does not duplicate a folder tab when the same root is opened twice", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.tabs).toHaveLength(1);
  });

  it("openFile is wired to the open-file event", async () => {
    const ref = captureListener("open-file");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(ref.handler).not.toBeNull();

    await act(async () => {
      ref.handler?.({ payload: "/p/evt.md" });
    });
    await waitFor(() => {
      expect(
        result.current.tabs.some((t) => t.kind === "file" && t.file.path === "/p/evt.md"),
      ).toBe(true);
    });
  });

  it("openFolder is wired to the open-folder event", async () => {
    const ref = captureListener("open-folder");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(ref.handler).not.toBeNull();

    await act(async () => {
      ref.handler?.({ payload: "/p/dropped" });
    });
    await waitFor(() => {
      expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/dropped")).toBe(
        true,
      );
    });
  });
});
