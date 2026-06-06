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
    onWorkspaceRefusal: vi.fn(),
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.createNote(folderId, "/p/ws");
    });

    expect(newPath).toBe("/p/ws/Untitled.md");
    expect(invoke).toHaveBeenCalledWith("create_note", { dir: "/p/ws", root: "/p/ws" });
    const folder = result.current.tabs.find((t) => t.id === folderId);
    const entries = folder?.kind === "folder" ? folder.nodes.get("/p/ws") : null;
    expect(entries?.some((e) => e.path === "/p/ws/Untitled.md")).toBe(true);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.createFolder(folderId, "/p/ws/sub");
    });

    expect(newPath).toBe("/p/ws/sub/Untitled Folder");
    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.expanded.has("/p/ws/sub") : false).toBe(true);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let finalPath: string | null = null;
    await act(async () => {
      finalPath = await result.current.renamePath(folderId, "/p/ws/Untitled.md", "My Note");
    });

    expect(finalPath).toBe("/p/ws/My Note.md");
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "/p/ws/Untitled.md",
      newName: "My Note",
      root: "/p/ws",
    });
  });

  it("create/rename are no-ops for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let a: string | null = "x";
    let b: string | null = "x";
    let c: string | null = "x";
    await act(async () => {
      a = await result.current.createNote("nope", "/p/ws");
      b = await result.current.createFolder("nope", "/p/ws");
      c = await result.current.renamePath("nope", "/p/ws/x.md", "y");
    });
    expect([a, b, c]).toEqual([null, null, null]);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let newPath: string | null = "x";
    await act(async () => {
      newPath = await result.current.createNote(folderId, "/p/ws");
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath(folderId, "/p/ws/note.md");
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath(folderId, "/p/ws/note.md");
    });

    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("delete_path", expect.anything());
  });

  it("deletePath closes the open file when it is the one removed", async () => {
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/note.md");
    });

    await act(async () => {
      await result.current.deletePath(folderId, "/p/ws/note.md");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file : "set").toBeNull();
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/note.md" });
  });

  it("deletePath is a no-op for an unknown tab id", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deletePath("nope", "/p/ws/x.md");
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.duplicatePath(folderId, "/p/ws/note.md");
    });

    expect(newPath).toBe("/p/ws/note copy.md");
    expect(invoke).toHaveBeenCalledWith("duplicate_path", {
      path: "/p/ws/note.md",
      root: "/p/ws",
    });
  });

  it("renamePath re-points the open file when it is the renamed entry", async () => {
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/note.md");
    });

    await act(async () => {
      await result.current.renamePath(folderId, "/p/ws/note.md", "renamed");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/renamed.md");
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/ws/renamed.md" });
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.movePath(folderId, "/p/ws/note.md", "/p/ws/sub");
    });

    expect(newPath).toBe("/p/ws/sub/note.md");
    expect(invoke).toHaveBeenCalledWith("move_path", {
      from: "/p/ws/note.md",
      toDir: "/p/ws/sub",
      root: "/p/ws",
    });
  });

  it("movePath re-points the open file when it is the moved entry", async () => {
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/note.md");
    });

    await act(async () => {
      await result.current.movePath(folderId, "/p/ws/note.md", "/p/ws/sub");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/sub/note.md");
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/ws/sub/note.md" });
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let p: string | null = null;
    await act(async () => {
      p = await result.current.movePath(folderId, "/p/ws/note.md", "/p/ws");
    });
    expect(p).toBe("/p/ws/note.md");
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });
    const expandedBefore = result.current.tabs.find((t) => t.id === folderId);
    expect(expandedBefore?.kind === "folder" ? expandedBefore.expanded.size : 0).toBe(1);

    act(() => {
      result.current.collapseAll(folderId);
    });

    const after = result.current.tabs.find((t) => t.id === folderId);
    expect(after?.kind === "folder" ? after.expanded.size : 1).toBe(0);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    await act(async () => {
      await result.current.expandAll(folderId);
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    const expanded = folder?.kind === "folder" ? folder.expanded : new Set<string>();
    expect(expanded.has("/p/ws/sub")).toBe(true);
    expect(expanded.has("/p/ws/sub/deep")).toBe(true);
    expect(folder?.kind === "folder" ? folder.nodes.has("/p/ws/sub/deep") : false).toBe(true);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    // limit 1: only the root is visited, so "sub" is expanded but not descended into.
    await act(async () => {
      await result.current.expandAll(folderId, 1);
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.expanded.has("/p/ws/sub") : false).toBe(true);
  });

  it("expandAll is a no-op for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.expandAll("nope");
    });
    expect(result.current.tabs).toHaveLength(0);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let rename: string | null = "x";
    let duplicate: string | null = "x";
    let moved: string | null = "x";
    let deleted = true;
    await act(async () => {
      rename = await result.current.renamePath(folderId, "/p/ws/a.md", "b");
      duplicate = await result.current.duplicatePath(folderId, "/p/ws/a.md");
      moved = await result.current.movePath(folderId, "/p/ws/a.md", "/p/ws/sub");
      deleted = await result.current.deletePath(folderId, "/p/ws/a.md");
    });

    expect([rename, duplicate, moved, deleted]).toEqual([null, null, null, false]);
    expect(spy).toHaveBeenCalled();
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

  it("openFileInFolderTab loads a markdown file into the folder tab", async () => {
    // Covers the happy path through the same gate the rejection test below
    // exercises, so both branches of the `isMarkdownFile` check show up
    // covered. Without this the partial-branch sliver lingers on codecov.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderTab = result.current.tabs.find((t) => t.kind === "folder");
    expect(folderTab).toBeDefined();

    await act(async () => {
      await result.current.openFileInFolderTab(folderTab!.id, "/p/ws/note.md");
    });

    const updated = result.current.tabs.find((t) => t.id === folderTab!.id);
    expect(updated?.kind === "folder" ? updated.file?.path : null).toBe("/p/ws/note.md");
  });

  it("opens a notebook inside a folder tab in view mode", async () => {
    // Covers the notebook → view-mode branch in openFileInFolderTab, mirroring
    // the top-level openFile case: a `.ipynb` is read-only regardless of the
    // configured default editor mode.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderTab = result.current.tabs.find((t) => t.kind === "folder");

    await act(async () => {
      await result.current.openFileInFolderTab(folderTab!.id, "/p/ws/analysis.ipynb");
    });

    const updated = result.current.tabs.find((t) => t.id === folderTab!.id);
    const file = updated?.kind === "folder" ? updated.file : null;
    expect(file?.path).toBe("/p/ws/analysis.ipynb");
    expect(file?.mode).toBe("view");
  });

  it("openFileInFolderTab refuses to load an unsupported extension", async () => {
    // Matches openFile: a `.txt` / `.html` / etc. dropped onto a folder tab
    // must not become the active file. Defends the renderer from arbitrary
    // HTML/JS the same way the top-level openFile gate does.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderTab = result.current.tabs.find((t) => t.kind === "folder");
    expect(folderTab).toBeDefined();

    await act(async () => {
      await result.current.openFileInFolderTab(folderTab!.id, "/p/ws/evil.txt");
    });

    const updated = result.current.tabs.find((t) => t.id === folderTab!.id);
    expect(updated?.kind === "folder" ? updated.file : null).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    warnSpy.mockRestore();
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

  it("auto-loads the first markdown file when opening a folder with no remembered file", async () => {
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
    await waitFor(() => {
      const folder = result.current.tabs.find((t) => t.kind === "folder");
      expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/a.md");
    });
  });

  it("auto-loads the remembered file when it still exists in the workspace", async () => {
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
    await waitFor(() => {
      const folder = result.current.tabs.find((t) => t.kind === "folder");
      expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/b.md");
    });
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
    await waitFor(() => {
      const folder = result.current.tabs.find((t) => t.kind === "folder");
      expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/a.md");
    });
  });

  it("does not auto-load anything when the workspace has no markdown files", async () => {
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
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder?.kind === "folder" ? folder.file : "missing").toBeNull();
  });

  it("openFileInFolderTab records the choice via workspace_set_last_file", async () => {
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder).toBeDefined();
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFileInFolderTab(folder!.id, "/p/ws/note.md");
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/ws",
      filePath: "/p/ws/note.md",
    });
  });

  it("refuses a folder nested inside a parent git repo (#262)", async () => {
    const onWorkspaceRefusal = vi.fn();
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
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceRefusal })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/repo/sub");
    });

    expect(result.current.tabs.some((t) => t.kind === "folder")).toBe(false);
    expect(onWorkspaceRefusal).toHaveBeenCalledWith(expect.stringContaining("/p/repo"));
  });

  it("refuses a folder nested inside another workspace's .glyph (#262)", async () => {
    const onWorkspaceRefusal = vi.fn();
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
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceRefusal })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/outer/inner");
    });

    expect(result.current.tabs.some((t) => t.kind === "folder")).toBe(false);
    expect(onWorkspaceRefusal).toHaveBeenCalledWith(expect.stringContaining("/p/outer"));
  });

  it("refuses a folder overlapping an already-open workspace (#262)", async () => {
    const onWorkspaceRefusal = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceRefusal })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/ws")).toBe(true);
    onWorkspaceRefusal.mockClear();

    // A child of the open workspace overlaps it.
    await act(async () => {
      await result.current.openFolder("/p/ws/sub");
    });
    expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/ws/sub")).toBe(
      false,
    );
    // A parent of the open workspace also overlaps it.
    await act(async () => {
      await result.current.openFolder("/p");
    });
    expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p")).toBe(false);
    expect(onWorkspaceRefusal).toHaveBeenCalledTimes(2);
  });

  it("re-opening the same workspace activates it instead of refusing", async () => {
    const onWorkspaceRefusal = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceRefusal })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(
      result.current.tabs.filter((t) => t.kind === "folder" && t.root === "/p/ws"),
    ).toHaveLength(1);
    expect(onWorkspaceRefusal).not.toHaveBeenCalled();
  });

  it("silently skips a nested folder on restore without bannering", async () => {
    const onWorkspaceRefusal = vi.fn();
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
          onWorkspaceRefusal,
          openTabs: [{ kind: "folder", path: "/p/repo/sub" }],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    expect(result.current.tabs.some((t) => t.kind === "folder")).toBe(false);
    expect(onWorkspaceRefusal).not.toHaveBeenCalled();
  });

  it("refuses and reports when workspace resolution fails", async () => {
    const onWorkspaceRefusal = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async () => {
          throw new Error("unreadable path");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceRefusal })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/broken");
    });

    expect(result.current.tabs.some((t) => t.kind === "folder")).toBe(false);
    expect(onWorkspaceRefusal).toHaveBeenCalledWith(expect.stringContaining("Couldn't open"));
  });

  it("openFolder with an explicit filePath skips the auto-load probe", async () => {
    // Covers the false arm of `wantsAutoLoad` on the openFolder branch:
    // the caller already knows which file to land on, so we must not
    // pre-fetch `list_markdown_files` for the auto-load path. Background
    // indexing still happens (covers the `resolvedFiles ? ... : loadWorkspaceFiles(...)`
    // false branch on line 391).
    let listCalls = 0;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => {
          listCalls += 1;
          return ["/p/ws/note.md"];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws", { filePath: "/p/ws/note.md" });
    });

    // One call — the background-indexing branch, not the auto-load probe.
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(1));
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    // Auto-load skipped: folder.file stays null when filePath is provided.
    expect(folder?.kind === "folder" ? folder.file : "missing").toBeNull();
  });

  it("openFolder skips auto-load when list_markdown_files returns a non-markdown target", async () => {
    // Covers the false arm of `isMarkdownFile(target)` inside the auto-load
    // branch (line 343). list_markdown_files in real life never returns
    // non-md paths, but the guard exists for defence in depth and still
    // counts toward the patch.
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
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder?.kind === "folder" ? folder.file : "missing").toBeNull();
  });

  it("openFolder logs and continues when auto-loading the remembered file fails", async () => {
    // Covers the catch arm on line 363: the file lookup succeeds but
    // `read_file` fails (deleted between list and load, or a transient
    // I/O error). The folder tab still opens, just without a pre-loaded
    // file, and the failure is surfaced to the console for debugging.
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
    await waitFor(() => {
      expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/ws")).toBe(true);
    });
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder?.kind === "folder" ? folder.file : "missing").toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("auto-load workspace file"),
      expect.anything(),
    );
    errorSpy.mockRestore();
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
