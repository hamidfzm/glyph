import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";
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
      case "workspace_resolve":
        // Default: a plain, non-nested folder that's always adoptable.
        return {
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: null,
        };
      case "workspace_get_last_file":
        return null;
      case "workspace_set_last_file":
        return undefined;
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
    onWorkspaceNotice: vi.fn(),
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

function watchDirectoryCalls(path: string) {
  return vi
    .mocked(invoke)
    .mock.calls.filter(
      (c) => c[0] === "watch_directory" && (c[1] as { path: string }).path === path,
    );
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
  it("ends up with no tabs and no workspace when nothing is provided", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.workspace).toBeNull();
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

  it("refuses to open a file whose extension isn't a supported type", async () => {
    // openFile gates unsupported extensions so a random `.txt` / `.html`
    // can't reach the renderer with embedded HTML / JS.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/evil.txt");
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    warnSpy.mockRestore();
  });

  it("opens a Jupyter notebook in view mode", async () => {
    // `.ipynb` is a supported type and is forced into view mode (read-only)
    // regardless of the default editor mode.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/analysis.ipynb");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.mode : null).toBe("view");
  });

  it("opens an image in view mode without reading it as text", async () => {
    // Images are binary: openFile must skip read_file (and the file watch)
    // entirely and load metadata only, opening the read-only image viewer.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/diagram.svg");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.mode : null).toBe("view");
    expect(tab.kind === "file" ? tab.file.content : "x").toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/diagram.svg" });
    expect(invoke).not.toHaveBeenCalledWith("watch_file", { path: "/p/diagram.svg" });
    expect(invoke).toHaveBeenCalledWith("get_file_metadata", { path: "/p/diagram.svg" });
  });

  it("never marks a notebook tab dirty when toggled into edit mode", async () => {
    // Notebooks are read-only: switching modes shows the JSON source view, not
    // an editor. The tab must never become dirty, or autosave would write the
    // raw JSON back and could corrupt the notebook.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/analysis.ipynb");
    });
    const id = result.current.tabs[0].id;

    await act(async () => {
      result.current.setTabMode(id, "edit");
    });

    const tab = result.current.tabs[0];
    const file = tab.kind === "file" ? tab.file : null;
    expect(file?.mode).toBe("edit");
    expect(file?.dirty).toBe(false);
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

  it("records a workspace note via workspace_set_last_file on open", async () => {
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/ws",
      filePath: "/p/ws/note.md",
    });
  });

  it("does not record a loose file outside the workspace as the last file", async () => {
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/q/loose.md");
    });

    expect(setLastFile).not.toHaveBeenCalled();
  });

  it("still opens the tab when workspace_set_last_file fails", async () => {
    // The remember-last-file write is fire-and-forget; a failure is never
    // fatal to opening the document.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_set_last_file: async () => {
          throw new Error("state.json unwritable");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    expect(
      result.current.tabs.some((t) => t.kind === "file" && t.file.path === "/p/ws/note.md"),
    ).toBe(true);
  });

  it("treats a file path equal to the workspace root as inside the workspace", async () => {
    // Defensive equality arm of the membership check. A root that is itself a
    // file path can't happen through the UI, but the guard exists and the
    // mocks don't care what the root looks like.
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/odd.md");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/p/odd.md");
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/odd.md",
      filePath: "/p/odd.md",
    });
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

  it("closeTab tolerates an unwatch_file failure", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        unwatch_file: async () => {
          throw new Error("watcher gone");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      result.current.closeTab(result.current.tabs[0].id);
    });

    expect(result.current.tabs).toHaveLength(0);
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

  it("setTabMode preserves editContent when switching between non-view modes", async () => {
    // Covers the branch where mode !== view but editContent is already set, so
    // the first-time seeding is skipped and the existing edit buffer survives.
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
      result.current.updateEditContent(tabId, "TYPED");
    });
    act(() => {
      result.current.setTabMode(tabId, "split");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.mode).toBe("split");
      // editContent is not re-seeded from content; the typed buffer is kept.
      expect(result.current.tabs[0].file.editContent).toBe("TYPED");
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

  it("toggleTask in view mode writes to disk and records an undoable edit", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
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
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/p/tasks.md",
      content: "- [x] task",
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/tasks.md",
      content: "- [ ] task",
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [ ] task");
    }

    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }
  });

  it("toggleTask in edit mode mutates editContent and is undoable", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("- [x] task");
      expect(result.current.tabs[0].file.dirty).toBe(true);
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("- [ ] task");
    }
  });

  it("commitEdit in view mode refreshes a stale editContent shadow", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: async () => undefined,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    // Editing seeds editContent; switching back to view leaves it behind.
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "EDIT-MODE-STATE");
    });
    act(() => {
      result.current.setTabMode(tabId, "view");
    });

    await act(async () => {
      await result.current.commitEdit(tabId, "VIEW-MODE-COMMIT");
    });
    if (result.current.tabs[0].kind === "file") {
      // Both content and the leftover shadow must advance, or consumers that
      // render `editContent ?? content` (the canvas viewer) would show the
      // pre-commit board.
      expect(result.current.tabs[0].file.content).toBe("VIEW-MODE-COMMIT");
      expect(result.current.tabs[0].file.editContent).toBe("VIEW-MODE-COMMIT");
    }
  });

  it("commitEdit in view mode writes to disk and is undoable", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/board.canvas", content: "B" });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("B");
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("A");
    }
  });

  it("commitEdit in edit mode mutates editContent and ignores no-op writes", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/doc.md");
    });
    const tabId = result.current.tabs[0].id;

    // No-op: committing the unchanged content does nothing.
    await act(async () => {
      await result.current.commitEdit(tabId, "A");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.dirty).toBe(false);
    }

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("B");
      expect(result.current.tabs[0].file.dirty).toBe(true);
    }
  });

  it("commitEdit is a no-op for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.commitEdit("nope", "X");
    });
  });

  it("commitEdit is a no-op for a graph tab", async () => {
    // Graph tabs have no document, so the activeFileOf read inside commitEdit
    // comes back null and nothing is written.
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
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
      await result.current.commitEdit(graphId, "X");
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("commitEdit diffs against the live edit buffer when one exists", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => "A" }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/doc.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.updateEditContent(tabId, "DRAFT");
    });
    // No-op: the committed content matches the edit buffer, not the disk content.
    await act(async () => {
      await result.current.commitEdit(tabId, "DRAFT");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("DRAFT");
    }

    await act(async () => {
      await result.current.commitEdit(tabId, "NEW");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("NEW");
    }

    // Undo restores the edit buffer the commit was diffed against.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("DRAFT");
    }
  });

  it("commitEdit records no undo entry when the disk write fails", async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    expect(writeFile).toHaveBeenCalledOnce();
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("A");
    }

    // Nothing was pushed onto the history stack, so undo has nothing to write.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("undoEdit is a no-op when there is no history", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
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
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("an external file-changed reload drops the undo stack", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    let body = "- [ ] task";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => body,
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );

    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    writeFile.mockClear();

    // Skip past the self-save grace window (1500ms) so the file-changed event
    // is treated as a true external reload rather than the echo of our write.
    const realNow = Date.now;
    const offset = 5000;
    Date.now = () => realNow() + offset;
    try {
      body = "EXTERNAL EDIT";
      await act(async () => {
        fileChanged.handler?.({ payload: "/p/tasks.md" });
        await new Promise((r) => setTimeout(r, 350));
      });
    } finally {
      Date.now = realNow;
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("skips an external reload while the file is dirty in edit mode", async () => {
    // Covers the guard that protects unsaved edits: a file-changed event must
    // not overwrite the in-memory editContent when the tab is dirty.
    let body = "original";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );

    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "unsaved work");
    });

    body = "EXTERNAL CHANGE";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    // The dirty edit buffer is preserved; the external change is not pulled in
    // (content stays the originally-loaded body, not the EXTERNAL CHANGE).
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("unsaved work");
      expect(result.current.tabs[0].file.content).toBe("original");
    }
  });

  it("ignores a file-changed event for an image path without reading it", async () => {
    // Images are never read as text; the auto-reload guard short-circuits on an
    // image path before any read_file, even if a stray event arrives.
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/diagram.svg");
    });
    vi.mocked(invoke).mockClear();

    await act(async () => {
      fileChanged.handler?.({ payload: "/p/diagram.svg" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/diagram.svg" });
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

  it("opens a folder as the workspace and watches it", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/ws" });
  });

  it("createNote invokes create_note and refreshes the target directory", async () => {
    const created = {
      name: "Untitled.md",
      path: "/p/ws/Untitled.md",
      isDirectory: false,
      modified: 0,
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        create_note: async () => "/p/ws/Untitled.md",
        read_directory: async () => [created],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.createNote("/p/ws");
    });

    expect(newPath).toBe("/p/ws/Untitled.md");
    expect(invoke).toHaveBeenCalledWith("create_note", { dir: "/p/ws", root: "/p/ws" });
    const entries = result.current.workspace?.nodes.get("/p/ws");
    expect(entries?.some((e) => e.path === "/p/ws/Untitled.md")).toBe(true);
  });

  it("createCanvas invokes create_canvas and refreshes the target directory", async () => {
    const created = {
      name: "Untitled.canvas",
      path: "/p/ws/Untitled.canvas",
      isDirectory: false,
      modified: 0,
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        create_canvas: async () => "/p/ws/Untitled.canvas",
        read_directory: async () => [created],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.createCanvas("/p/ws");
    });

    expect(newPath).toBe("/p/ws/Untitled.canvas");
    expect(invoke).toHaveBeenCalledWith("create_canvas", { dir: "/p/ws", root: "/p/ws" });
    const entries = result.current.workspace?.nodes.get("/p/ws");
    expect(entries?.some((e) => e.path === "/p/ws/Untitled.canvas")).toBe(true);
  });

  it("createFolder invokes create_folder and expands the target directory", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        create_folder: async () => "/p/ws/sub/Untitled Folder",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.createFolder("/p/ws/sub");
    });

    expect(newPath).toBe("/p/ws/sub/Untitled Folder");
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
  });

  it("renamePath invokes rename_path and returns the final path", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => "/p/ws/My Note.md",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let finalPath: string | null = null;
    await act(async () => {
      finalPath = await result.current.renamePath("/p/ws/Untitled.md", "My Note");
    });

    expect(finalPath).toBe("/p/ws/My Note.md");
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "/p/ws/Untitled.md",
      newName: "My Note",
      root: "/p/ws",
    });
  });

  it("create/rename are no-ops when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let a: string | null = "x";
    let b: string | null = "x";
    let c: string | null = "x";
    let d: string | null = "x";
    await act(async () => {
      a = await result.current.createNote("/p/ws");
      b = await result.current.createFolder("/p/ws");
      c = await result.current.createCanvas("/p/ws");
      d = await result.current.renamePath("/p/ws/x.md", "y");
    });
    expect([a, b, c, d]).toEqual([null, null, null, null]);
  });

  it("createNote returns null and logs when the command fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        create_note: async () => {
          throw new Error("denied");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = "x";
    await act(async () => {
      newPath = await result.current.createNote("/p/ws");
    });
    expect(newPath).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it("deletePath confirms, invokes delete_path, and refreshes", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath("/p/ws/note.md");
    });

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("delete_path", {
      path: "/p/ws/note.md",
      root: "/p/ws",
    });
  });

  it("deletePath does nothing when the confirmation is declined", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath("/p/ws/note.md");
    });

    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("delete_path", expect.anything());
  });

  it("deletePath closes every open tab under the deleted path", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/other.md");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/sub/a.md");
    });
    // The doomed tab is active, so closing it must fall back to a neighbor.
    expect(result.current.activeTab?.kind).toBe("file");

    await act(async () => {
      await result.current.deletePath("/p/ws/sub");
    });

    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/other.md");
    }
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/sub/a.md" });
  });

  it("deletePath is a no-op when no workspace is open", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath("/p/ws/x.md");
    });
    expect(ok).toBe(false);
  });

  it("duplicatePath invokes duplicate_path and refreshes", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        duplicate_path: async () => "/p/ws/note copy.md",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.duplicatePath("/p/ws/note.md");
    });

    expect(newPath).toBe("/p/ws/note copy.md");
    expect(invoke).toHaveBeenCalledWith("duplicate_path", {
      path: "/p/ws/note.md",
      root: "/p/ws",
    });
  });

  it("renamePath re-points an open tab whose file is the renamed entry", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => "/p/ws/renamed.md",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // A loose tab outside the renamed path must stay untouched.
    await act(async () => {
      await result.current.openFile("/q/loose.md");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    await act(async () => {
      await result.current.renamePath("/p/ws/note.md", "renamed");
    });

    const paths = result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : null));
    expect(paths).toEqual(["/q/loose.md", "/p/ws/renamed.md"]);
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/note.md" });
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/ws/renamed.md" });
  });

  it("renamePath still re-points the tab when the watcher hand-off fails", async () => {
    // Both the unwatch of the old path and the watch of the new path are
    // fire-and-forget; failures must not break the rename.
    let failWatchers = false;
    const boomWhenArmed = async () => {
      if (failWatchers) throw new Error("watcher gone");
      return undefined;
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => "/p/ws/renamed.md",
        unwatch_file: boomWhenArmed,
        watch_file: boomWhenArmed,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    failWatchers = true;
    await act(async () => {
      await result.current.renamePath("/p/ws/note.md", "renamed");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/renamed.md");
    }
  });

  it("movePath invokes move_path and returns the new path", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => "/p/ws/sub/note.md",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.movePath("/p/ws/note.md", "/p/ws/sub");
    });

    expect(newPath).toBe("/p/ws/sub/note.md");
    expect(invoke).toHaveBeenCalledWith("move_path", {
      from: "/p/ws/note.md",
      toDir: "/p/ws/sub",
      root: "/p/ws",
    });
  });

  it("movePath re-points open tabs inside the moved folder", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => "/p/ws/dest/sub",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/sub/a.md");
    });

    await act(async () => {
      await result.current.movePath("/p/ws/sub", "/p/ws/dest");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/dest/sub/a.md");
    }
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/sub/a.md" });
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/ws/dest/sub/a.md" });
  });

  it("movePath returns the original path on a no-op move", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => "/p/ws/note.md",
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let p: string | null = null;
    await act(async () => {
      p = await result.current.movePath("/p/ws/note.md", "/p/ws");
    });
    expect(p).toBe("/p/ws/note.md");
  });

  it("movePath prunes cached listings under the moved folder", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => "/p/ws/dest/sub",
        read_directory: async (_cmd, args) => {
          const p = String(args?.path ?? "");
          if (p === "/p/ws")
            return [
              { name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 },
              { name: "dest", path: "/p/ws/dest", isDirectory: true, modified: 0 },
            ];
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });

    await act(async () => {
      await result.current.movePath("/p/ws/sub", "/p/ws/dest");
    });

    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(false);
  });

  it("deletePath prunes only the deleted folder, keeping unrelated expanded siblings", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        read_directory: async (_cmd, args) => {
          const p = String(args?.path ?? "");
          if (p === "/p/ws")
            return [
              { name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 },
              { name: "other", path: "/p/ws/other", isDirectory: true, modified: 0 },
            ];
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // Separate acts: each expand must commit (and refresh the workspace ref)
    // before the next one reads it.
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    await act(async () => {
      await result.current.toggleExpand("/p/ws/other");
    });

    await act(async () => {
      await result.current.deletePath("/p/ws/sub");
    });

    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(false);
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(false);
    // The unrelated expanded sibling is kept (covers the "not inside" branch).
    expect(result.current.workspace?.expanded.has("/p/ws/other")).toBe(true);
  });

  it("deletePath copes with a path that has no name component", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.deletePath("/");
    });
    expect(ok).toBe(true);
  });

  it("deletePath tolerates an unwatch_file failure when closing the doomed tab", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        unwatch_file: async () => {
          throw new Error("watcher gone");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.deletePath("/p/ws/note.md");
    });

    expect(ok).toBe(true);
    expect(result.current.tabs).toHaveLength(0);
  });

  it("duplicate/move are no-ops when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let d: string | null = "x";
    let mv: string | null = "x";
    await act(async () => {
      d = await result.current.duplicatePath("/p/ws/a.md");
      mv = await result.current.movePath("/p/ws/a.md", "/p/ws/sub");
    });
    expect([d, mv]).toEqual([null, null]);
  });

  it("collapseAll clears the expanded directories", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async () => [
          { name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 },
        ],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.size).toBe(1);

    act(() => {
      result.current.collapseAll();
    });

    expect(result.current.workspace?.expanded.size).toBe(0);
  });

  it("collapseAll is a no-op when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.collapseAll();
    });

    expect(result.current.workspace).toBeNull();
  });

  it("expandAll loads and expands every nested directory", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          const p = String(args?.path ?? "");
          if (p === "/p/ws")
            return [
              { name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 },
              { name: "a.md", path: "/p/ws/a.md", isDirectory: false, modified: 0 },
            ];
          if (p === "/p/ws/sub")
            return [{ name: "deep", path: "/p/ws/sub/deep", isDirectory: true, modified: 0 }];
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await act(async () => {
      await result.current.expandAll();
    });

    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(result.current.workspace?.expanded.has("/p/ws/sub/deep")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub/deep")).toBe(true);
  });

  it("expandAll stops at the given directory limit", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          const p = String(args?.path ?? "");
          if (p === "/p/ws")
            return [{ name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 }];
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    // limit 1: only the root is visited, so "sub" is expanded but not descended into.
    await act(async () => {
      await result.current.expandAll(1);
    });

    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(false);
  });

  it("expandAll is a no-op when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.expandAll();
    });
    expect(result.current.workspace).toBeNull();
  });

  it("rename/duplicate/move/delete return falsy and log when the command fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(true);
    const boom = async () => {
      throw new Error("denied");
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: boom,
        duplicate_path: boom,
        move_path: boom,
        delete_path: boom,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    let rename: string | null = "x";
    let duplicate: string | null = "x";
    let moved: string | null = "x";
    let deleted = true;
    await act(async () => {
      rename = await result.current.renamePath("/p/ws/a.md", "b");
      duplicate = await result.current.duplicatePath("/p/ws/a.md");
      moved = await result.current.movePath("/p/ws/a.md", "/p/ws/sub");
      deleted = await result.current.deletePath("/p/ws/a.md");
    });

    expect([rename, duplicate, moved, deleted]).toEqual([null, null, null, false]);
    expect(spy).toHaveBeenCalled();
  });

  it("re-opening the same workspace root is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(watchDirectoryCalls("/p/ws")).toHaveLength(1);
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

  it("auto-opens the first markdown file when opening a folder with no remembered file", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md", "/p/ws/b.md"],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("auto-opens the remembered file when it still exists in the workspace", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md", "/p/ws/b.md"],
        workspace_get_last_file: async () => "/p/ws/b.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/b.md");
    }
  });

  it("falls back to the first file when the remembered file no longer exists", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md", "/p/ws/b.md"],
        workspace_get_last_file: async () => "/p/ws/gone.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("falls back to the first file when the remembered-file lookup fails", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md"],
        workspace_get_last_file: async () => {
          throw new Error("state.json unreadable");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("does not auto-open anything when the workspace has no markdown files", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/empty");
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("skips the auto-open probe when autoLoad is false", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md"],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws", { autoLoad: false });
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("workspace_get_last_file", expect.anything());
  });

  it("skips auto-open when list_markdown_files returns a non-markdown target", async () => {
    // Covers the false arm of `isMarkdownFile(target)` inside the auto-open
    // branch. list_markdown_files in real life never returns non-md paths,
    // but the guard exists for defence in depth.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/notes.txt"],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("opens the workspace without a tab when auto-opening the first file fails", async () => {
    // The auto-open goes through openFile, whose own catch logs the failure.
    // The workspace itself still opens.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md"],
        read_file: async () => {
          throw new Error("vanished");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith("Failed to open file:", expect.anything());
    errorSpy.mockRestore();
  });

  it("opens a folder nested inside a parent git repo with a persistent warning (#262)", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: true,
          gitTopLevel: "/p/repo",
          nestedUnder: "/p/repo",
          glyphConflict: null,
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/repo/sub");
    });

    // The folder opens (no longer refused) but a persistent warning is shown.
    expect(result.current.workspace?.root).toBe("/p/repo/sub");
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.nestedUnderGit", values: { path: "/p/repo" } },
      { persistent: true },
    );
  });

  it("refuses a folder nested inside another workspace's .glyph (#262)", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: "/p/outer",
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/outer/inner");
    });

    expect(result.current.workspace).toBeNull();
    expect(onWorkspaceNotice).toHaveBeenCalledWith({
      key: "notice.nestedWorkspace",
      values: { path: "/p/outer" },
    });
  });

  it("restores a nested folder silently without bannering", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: true,
          gitTopLevel: "/p/repo",
          nestedUnder: "/p/repo",
          glyphConflict: null,
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onWorkspaceNotice,
          openTabs: [{ kind: "folder", path: "/p/repo/sub" }],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    // A nested folder reopens on restore, but the warning banner stays silent.
    expect(result.current.workspace?.root).toBe("/p/repo/sub");
    expect(onWorkspaceNotice).not.toHaveBeenCalled();
  });

  it("refuses and reports when workspace resolution fails", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async () => {
          throw new Error("unreadable path");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/broken");
    });

    expect(result.current.workspace).toBeNull();
    expect(onWorkspaceNotice).toHaveBeenCalledWith({
      key: "error.couldntOpen",
      values: { error: expect.stringContaining("unreadable path") },
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
      expect(result.current.workspace?.root).toBe("/p/dropped");
    });
  });
});

describe("useTabs workspace lifecycle", () => {
  it("opening another folder replaces the workspace and closes its tabs", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/a");
    });
    await act(async () => {
      await result.current.openFile("/p/a/note.md");
    });
    await act(async () => {
      await result.current.openFile("/q/loose.md");
    });
    act(() => {
      result.current.openGraph();
    });
    expect(result.current.tabs).toHaveLength(3);

    await act(async () => {
      await result.current.openFolder("/p/b");
    });

    expect(result.current.workspace?.root).toBe("/p/b");
    expect(invoke).toHaveBeenCalledWith("unwatch_directory", { path: "/p/a" });
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/b" });
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/a/note.md" });
    // Only the loose external tab survives; the old workspace's file tab and
    // the graph tab are gone.
    const paths = result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : "(graph)"));
    expect(paths).toEqual(["/q/loose.md"]);
  });

  it("replacement still proceeds when unwatching the old root fails", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        unwatch_directory: async () => {
          throw new Error("watcher gone");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/a");
    });
    await act(async () => {
      await result.current.openFolder("/p/b");
    });

    expect(result.current.workspace?.root).toBe("/p/b");
  });

  it("closeWorkspace closes member tabs and the graph but keeps loose tabs", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/note.md"],
        scan_wikilinks: async () => [
          { source: "/p/ws/note.md", target: "x", line: 1, snippet: "[[x]]" },
        ],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await waitFor(() => expect(result.current.wikilinkRefs).toHaveLength(1));
    await act(async () => {
      await result.current.openFile("/q/loose.md");
    });
    act(() => {
      result.current.openGraph();
    });
    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.closeWorkspace();
    });

    expect(result.current.workspace).toBeNull();
    expect(result.current.workspaceFiles).toEqual([]);
    expect(result.current.wikilinkRefs).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("unwatch_directory", { path: "/p/ws" });
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/note.md" });
    const paths = result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : "(graph)"));
    expect(paths).toEqual(["/q/loose.md"]);
  });

  it("closeWorkspace is a no-op when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.closeWorkspace();
    });

    expect(invoke).not.toHaveBeenCalledWith("unwatch_directory", expect.anything());
  });

  it("closeWorkspace tolerates failing unwatch commands", async () => {
    const boom = async () => {
      throw new Error("watcher gone");
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ unwatch_directory: boom, unwatch_file: boom }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    await act(async () => {
      result.current.closeWorkspace();
    });

    expect(result.current.workspace).toBeNull();
    expect(result.current.tabs).toHaveLength(0);
  });

  it("drops a stale wikilink scan that lands after the workspace was replaced", async () => {
    let releaseStale: ((refs: unknown[]) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        scan_wikilinks: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/a") {
            return new Promise((resolve) => {
              releaseStale = resolve;
            });
          }
          return Promise.resolve([]);
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/a");
    });
    await act(async () => {
      await result.current.openFolder("/p/b");
    });

    await act(async () => {
      releaseStale?.([{ source: "/p/a/x.md", target: "y", line: 1, snippet: "[[y]]" }]);
      await Promise.resolve();
    });

    // The slow scan for the replaced workspace must not clobber /p/b's refs.
    expect(result.current.wikilinkRefs).toEqual([]);
  });
});

describe("useTabs workspace teardown races", () => {
  // Every tree mutation re-reads a directory listing after its Rust command
  // resolves. If the workspace is closed while that read is pending, the
  // trailing setWorkspace must keep the null state instead of resurrecting
  // the old tree. These tests park the read on a deferred promise, close the
  // workspace, then release the read.
  function deferReadDirectory(target: string) {
    let release: ((entries: unknown[]) => void) | null = null;
    const overrides: Partial<Record<string, Invoker>> = {
      read_directory: (_cmd, args) => {
        const p = String(args?.path ?? "");
        if (p === target) {
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        if (p === "/p/ws")
          return Promise.resolve([
            { name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 },
          ]);
        return Promise.resolve([]);
      },
      rename_path: async () => "/p/ws/renamed.md",
      duplicate_path: async () => "/p/ws/copy.md",
      move_path: async () => "/p/ws/dest/a.md",
      create_note: async () => "/p/ws/sub/Untitled.md",
      delete_path: async () => undefined,
    };
    vi.mocked(invoke).mockImplementation(makeInvoker(overrides) as typeof invoke);
    return { release: (entries: unknown[] = []) => release?.(entries) };
  }

  async function raceAgainstClose(
    target: string,
    run: (hook: ReturnType<typeof useTabs>) => Promise<unknown>,
  ) {
    vi.mocked(ask).mockResolvedValue(true);
    const deferred = deferReadDirectory(target);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await act(async () => {
      const pending = run(result.current);
      // Let the operation pass its command and park on the deferred read.
      await new Promise((r) => setTimeout(r, 0));
      result.current.closeWorkspace();
      deferred.release();
      await pending;
    });

    expect(result.current.workspace).toBeNull();
  }

  it("toggleExpand result arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.toggleExpand("/p/ws/sub"));
  });

  it("createNote refresh arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.createNote("/p/ws/sub"));
  });

  it("renamePath refresh arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.renamePath("/p/ws/sub/a.md", "renamed"));
  });

  it("duplicatePath refresh arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.duplicatePath("/p/ws/sub/a.md"));
  });

  it("movePath refresh arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.movePath("/p/ws/sub/a.md", "/p/ws/dest"));
  });

  it("deletePath refresh arriving after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.deletePath("/p/ws/sub/a.md"));
  });

  it("expandAll walk finishing after closeWorkspace is dropped", async () => {
    await raceAgainstClose("/p/ws/sub", (hook) => hook.expandAll());
  });

  it("a directory-changed refresh finishing after closeWorkspace is dropped", async () => {
    const dirChanged = captureListener("directory-changed");
    let release: ((files: string[]) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/ws") {
            return new Promise((resolve) => {
              release = resolve;
            });
          }
          return Promise.resolve([]);
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      // openFolder itself awaits the markdown index, so free its read before
      // awaiting the open; the event's refresh then gets a fresh deferred.
      const opening = result.current.openFolder("/p/ws");
      await new Promise((r) => setTimeout(r, 0));
      release?.([]);
      release = null;
      await opening;
    });

    await act(async () => {
      dirChanged.handler?.({ payload: "/p/ws" });
      // Past the refresh debounce: the handler is now parked on the index read.
      await new Promise((r) => setTimeout(r, 350));
      result.current.closeWorkspace();
      release?.([]);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.workspace).toBeNull();
  });
});

describe("useTabs command failures", () => {
  it("falls back to empty listings when directory reads and workspace scans fail", async () => {
    // Covers the catch arms of loadDirectory, loadWorkspaceFiles, and
    // loadWikilinkRefs: each logs and degrades to an empty result so a
    // permission error on one Rust command never breaks the workspace.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = async () => {
      throw new Error("denied");
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: boom,
        list_markdown_files: boom,
        scan_wikilinks: boom,
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

describe("useTabs concurrent opens", () => {
  it("two concurrent openFile calls for the same path produce one tab", async () => {
    // Both calls pass the synchronous duplicate check before either commits
    // state, so the guard inside the setState updater has to dedupe.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await Promise.all([
        result.current.openFile("/p/dup.md"),
        result.current.openFile("/p/dup.md"),
      ]);
    });

    expect(result.current.tabs).toHaveLength(1);
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/dup.md");
    }
  });

  it("a second openFolder for an in-flight root is a no-op", async () => {
    // Mirrors the StrictMode double-mount scenario the in-flight guard
    // defends against: the first open is parked on read_directory when the
    // second call arrives.
    let release: ((entries: unknown[]) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/ws" && !release) {
            return new Promise((resolve) => {
              release = resolve;
            });
          }
          return Promise.resolve([]);
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      const first = result.current.openFolder("/p/ws");
      // Let the first call pass resolution, set the in-flight guard, and park
      // on the deferred directory read.
      await new Promise((r) => setTimeout(r, 0));
      const second = result.current.openFolder("/p/ws");
      release?.([]);
      await Promise.all([first, second]);
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(watchDirectoryCalls("/p/ws")).toHaveLength(1);
  });
});

describe("useTabs workspace interactions", () => {
  it("openFolder with no path prompts a dialog and routes the choice via the window manager", async () => {
    vi.mocked(open).mockResolvedValue("/p/picked");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    // The pick is handed to Rust routing (which may focus, adopt, or spawn a
    // window); the frontend does not adopt it directly here.
    expect(invoke).toHaveBeenCalledWith("request_open", { kind: "folder", path: "/p/picked" });
  });

  it("openFolder bails when the directory dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(result.current.workspace).toBeNull();
  });

  it("openFolder restores persisted expanded directories and pre-loads their listings", async () => {
    const readDirs: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          readDirs.push(String(args?.path ?? ""));
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws", { expanded: ["/p/ws/sub"] });
    });

    expect(readDirs).toContain("/p/ws/sub");
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(true);
  });

  it("toggleExpand is a no-op when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });

    expect(result.current.workspace).toBeNull();
  });

  it("toggleExpand collapses an expanded directory and reuses cached listings", async () => {
    let subReads = 0;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/ws/sub") subReads += 1;
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(false);

    // Re-expanding hits the cached listing instead of re-reading the directory.
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);
  });

  it("setActiveTab leaving a graph tab keeps it unchanged", async () => {
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
      await result.current.openFile("/p/a.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")?.id as string;

    act(() => {
      result.current.setActiveTab(graphId);
    });
    // Leaving the graph tab: it has no file to stamp a scroll position on.
    act(() => {
      result.current.setActiveTab(fileId);
    });

    const graph = result.current.tabs.find((t) => t.id === graphId);
    expect(graph?.kind === "graph" ? graph.file : "set").toBeNull();
    expect(result.current.activeTabId).toBe(fileId);
  });

  it("setTabMode on a graph tab is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    const graphId = result.current.tabs.find((t) => t.kind === "graph")?.id as string;

    act(() => {
      result.current.setTabMode(graphId, "edit");
    });

    const graph = result.current.tabs.find((t) => t.id === graphId);
    expect(graph?.kind === "graph" ? graph.file : "set").toBeNull();
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

    act(() => {
      result.current.closeTab("nope");
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

    act(() => {
      result.current.closeTab(tabId);
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

  it("openFileDialog opens a single path when the dialog returns a string", async () => {
    vi.mocked(open).mockResolvedValue("/p/solo.md");
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

describe("useTabs persistence", () => {
  it("persists the workspace as a leading folder entry without a filePath key", async () => {
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

    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      const last = calls[calls.length - 1]?.[1];
      // Exact shapes: the workspace entry carries no filePath, and document
      // tabs follow in strip order.
      expect(last).toEqual([
        { kind: "folder", path: "/p/ws", expanded: ["/p/ws/sub"] },
        { kind: "file", path: "/p/ws/note.md" },
      ]);
    });
    const activeCalls = onSettingsChange.mock.calls.filter(
      (c) => c[0] === "behavior.activeTabPath",
    );
    expect(activeCalls[activeCalls.length - 1]?.[1]).toBe("/p/ws/note.md");
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

describe("useTabs file-changed events", () => {
  it("ignores file-changed when autoReload is off", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: false })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("v1");
    }
  });

  it("ignores file-changed for a path with no open tab", async () => {
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      fileChanged.handler?.({ payload: "/p/other.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/other.md" });
  });

  it("skips the reload triggered by our own recent save", async () => {
    let body = "- [ ] task";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    // The watcher echoes our own write within the grace window; the reload is
    // suppressed so the toggled content is kept even though disk says otherwise.
    body = "DISK STATE";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/tasks.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }
  });

  it("keeps the current content when the reload read fails", async () => {
    let fail = false;
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => {
          if (fail) throw new Error("io error");
          return "v1";
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    fail = true;
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("v1");
    }
  });

  it("reloads the matching file tab and leaves the graph tab alone", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => body,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    await act(async () => {
      await result.current.openFile("/p/ws/a.md");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/ws/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const fileTab = result.current.tabs.find((t) => t.kind === "file");
    expect(fileTab?.kind === "file" ? fileTab.file.content : null).toBe("v2");
    expect(result.current.tabs.some((t) => t.kind === "graph")).toBe(true);
  });
});

describe("useTabs directory-changed events", () => {
  it("refreshes the workspace tree and rebuilds the workspace indices", async () => {
    const dirChanged = captureListener("directory-changed");
    let files: string[] = [];
    let rootEntries = [{ name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 }];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) =>
          String(args?.path ?? "") === "/p/ws" ? rootEntries : [],
        list_markdown_files: async () => files,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // Load a subdirectory so the refresh sweep covers cached child listings too.
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });

    // Something outside the app adds a file.
    files = ["/p/ws/new.md"];
    rootEntries = [
      ...rootEntries,
      { name: "new.md", path: "/p/ws/new.md", isDirectory: false, modified: 0 },
    ];
    await act(async () => {
      // Fire twice in quick succession: the second event resets the debounce
      // timer rather than scheduling a parallel refresh.
      dirChanged.handler?.({ payload: "/p/ws" });
      dirChanged.handler?.({ payload: "/p/ws" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const rootListing = result.current.workspace?.nodes.get("/p/ws");
    expect(rootListing?.some((e) => e.path === "/p/ws/new.md")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(true);
    await waitFor(() => {
      expect(result.current.workspaceFiles).toEqual(["/p/ws/new.md"]);
    });
  });

  it("ignores directory-changed for a root that isn't open", async () => {
    const dirChanged = captureListener("directory-changed");
    const readDirs: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          readDirs.push(String(args?.path ?? ""));
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const readsBefore = readDirs.length;

    await act(async () => {
      dirChanged.handler?.({ payload: "/p/other" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(readDirs.length).toBe(readsBefore);
  });
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
        list_markdown_files: async () => ["/p/ws/a.md", "/p/ws/b.md"],
        scan_wikilinks: async () => [
          { source: "/p/ws/a.md", target: "b", line: 1, snippet: "[[b]]" },
        ],
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

  it("closeWorkspace closes the graph tab", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    act(() => result.current.closeWorkspace());
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it("closing the graph tab keeps the workspace open", async () => {
    const result = await openWorkspace();
    act(() => result.current.openGraph());
    const graphId = result.current.activeTabId as string;
    act(() => result.current.closeTab(graphId));
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
});
