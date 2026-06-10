import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderTab, Tab } from "./useTabs";
import { mapFolderTab, useTabs } from "./useTabs";

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

describe("mapFolderTab", () => {
  const folder: FolderTab = {
    id: "d",
    kind: "folder",
    root: "/r",
    expanded: new Set(),
    nodes: new Map(),
    file: null,
  };
  const fileTab = { id: "f", kind: "file" } as unknown as Tab;

  it("updates the matching folder tab and leaves others untouched", () => {
    const out = mapFolderTab([fileTab, folder], "d", (t) => ({ ...t, root: "/x" }));
    expect((out[1] as FolderTab).root).toBe("/x");
    expect(out[0]).toBe(fileTab);
  });

  it("does nothing when no folder tab has the id", () => {
    const update = vi.fn((t: FolderTab) => t);
    mapFolderTab([fileTab, folder], "missing", update);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not update a non-folder tab whose id matches", () => {
    const update = vi.fn((t: FolderTab) => t);
    mapFolderTab([{ ...fileTab, id: "d" }], "d", update);
    expect(update).not.toHaveBeenCalled();
  });
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });

    await act(async () => {
      await result.current.movePath(folderId, "/p/ws/sub", "/p/ws/dest");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.nodes.has("/p/ws/sub") : true).toBe(false);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
      await result.current.toggleExpand(folderId, "/p/ws/other");
    });

    await act(async () => {
      await result.current.deletePath(folderId, "/p/ws/sub");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    const f = folder?.kind === "folder" ? folder : null;
    expect(f?.nodes.has("/p/ws/sub")).toBe(false);
    expect(f?.expanded.has("/p/ws/sub")).toBe(false);
    // The unrelated expanded sibling is kept (covers the "not inside" branch).
    expect(f?.expanded.has("/p/ws/other")).toBe(true);
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    let ok = false;
    await act(async () => {
      ok = await result.current.deletePath(folderId, "/");
    });
    expect(ok).toBe(true);
  });

  it("duplicate/move are no-ops for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let d: string | null = "x";
    let mv: string | null = "x";
    await act(async () => {
      d = await result.current.duplicatePath("nope", "/p/ws/a.md");
      mv = await result.current.movePath("nope", "/p/ws/a.md", "/p/ws/sub");
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

describe("useTabs command failures", () => {
  it("falls back to empty listings when directory reads and workspace scans fail", async () => {
    // Covers the catch arms of loadDirectory, loadWorkspaceFiles, and
    // loadWikilinkRefs: each logs and degrades to an empty result so a
    // permission error on one Rust command never breaks the folder tab.
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

    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder?.kind === "folder" ? folder.nodes.get("/p/ws") : null).toEqual([]);
    expect(folder?.kind === "folder" ? folder.file : "set").toBeNull();
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

  it("openFileInFolderTab logs and keeps the folder file unset when the read fails", async () => {
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
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/note.md");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file : "set").toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("Failed to open file in folder tab:", expect.anything());
    errorSpy.mockRestore();
  });

  it("openFolder still opens the tab when watch_directory fails", async () => {
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

    expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/ws")).toBe(true);
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

  it("two concurrent openFolder calls for the same root produce one tab", async () => {
    // Mirrors the StrictMode double-mount scenario the post-await re-check in
    // openFolder defends against.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await Promise.all([result.current.openFolder("/p/ws"), result.current.openFolder("/p/ws")]);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].kind).toBe("folder");
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });
});

describe("useTabs folder tab interactions", () => {
  it("openFolder with no path prompts with a directory dialog", async () => {
    vi.mocked(open).mockResolvedValue("/p/picked");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(result.current.tabs.some((t) => t.kind === "folder" && t.root === "/p/picked")).toBe(
      true,
    );
  });

  it("openFolder bails when the directory dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(result.current.tabs).toHaveLength(0);
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
    const folder = result.current.tabs.find((t) => t.kind === "folder");
    expect(folder?.kind === "folder" ? folder.expanded.has("/p/ws/sub") : false).toBe(true);
    expect(folder?.kind === "folder" ? folder.nodes.has("/p/ws/sub") : false).toBe(true);
  });

  it("openFileInFolderTab unwatches the previously open file when switching", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/a.md");
    });
    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/b.md");
    });

    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/a.md" });
    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file?.path : null).toBe("/p/ws/b.md");
  });

  it("openFileInFolderTab is a no-op when the file is already open", async () => {
    const reads: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async (_cmd, args) => {
          reads.push(String(args?.path ?? ""));
          return "FILE BODY";
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
      await result.current.openFileInFolderTab(folderId, "/p/ws/a.md");
    });
    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/a.md");
    });

    expect(reads.filter((p) => p === "/p/ws/a.md")).toHaveLength(1);
  });

  it("toggleExpand is a no-op for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.toggleExpand("nope", "/p/ws/sub");
    });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("folder tab updates leave sibling tabs untouched", async () => {
    // Exercises the per-tab mapping arms (openFileInFolderTab, toggleExpand,
    // setTabMode, setActiveTab) with a second, unrelated file tab present so
    // the "not this tab" branches actually run.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async (_cmd, args) =>
          String(args?.path ?? "") === "/p/ws" ? ["/p/ws/a.md"] : [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/solo.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")!.id;
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    await act(async () => {
      await result.current.openFileInFolderTab(folderId, "/p/ws/b.md");
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });
    act(() => {
      result.current.setTabMode(folderId, "edit");
    });
    // The folder tab (which has an open file) is active; switching away stamps
    // the scroll position on its file rather than the sibling's.
    act(() => {
      result.current.setActiveTab(fileId);
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    const folderFile = folder?.kind === "folder" ? folder.file : null;
    expect(folderFile?.path).toBe("/p/ws/b.md");
    expect(folderFile?.mode).toBe("edit");
    const sibling = result.current.tabs.find((t) => t.id === fileId);
    if (sibling?.kind === "file") {
      expect(sibling.file.path).toBe("/p/solo.md");
      expect(sibling.file.mode).toBe("view");
    }
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    const expandedOf = () => {
      const folder = result.current.tabs.find((t) => t.id === folderId);
      return folder?.kind === "folder" ? folder.expanded : new Set<string>();
    };

    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });
    expect(expandedOf().has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);

    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });
    expect(expandedOf().has("/p/ws/sub")).toBe(false);

    // Re-expanding hits the cached listing instead of re-reading the directory.
    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
    });
    expect(expandedOf().has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);
  });

  it("closeTab on a folder tab unwatches the directory and open file and drops its indices", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => ["/p/ws/a.md"],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    // Wait for the background workspace index so the close actually has
    // index entries to drop.
    await waitFor(() => expect(result.current.workspaceFiles).toEqual(["/p/ws/a.md"]));

    act(() => {
      result.current.closeTab(folderId);
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("unwatch_directory", { path: "/p/ws" });
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/ws/a.md" });
  });

  it("closeTab on a folder tab without an open file skips the file unwatch", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    act(() => {
      result.current.closeTab(folderId);
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("unwatch_directory", { path: "/p/ws" });
    expect(invoke).not.toHaveBeenCalledWith("unwatch_file", expect.anything());
  });

  it("setActiveTab leaving a folder tab without an open file keeps it unchanged", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")!.id;

    act(() => {
      result.current.setActiveTab(folderId);
    });
    // Leaving the folder tab: it has no file to stamp a scroll position on.
    act(() => {
      result.current.setActiveTab(fileId);
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file : "set").toBeNull();
    expect(result.current.activeTabId).toBe(fileId);
  });

  it("setTabMode on a folder tab without an open file is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;

    act(() => {
      result.current.setTabMode(folderId, "edit");
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file : "set").toBeNull();
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

  it("toggleTask is a no-op for unknown tabs, fileless folder tabs, and unchanged lines", async () => {
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
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")!.id;

    await act(async () => {
      await result.current.toggleTask("nope", 1);
      await result.current.toggleTask(folderId, 1);
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

  it("reloads the open file inside a folder tab", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => body,
        list_markdown_files: async (_cmd, args) =>
          String(args?.path ?? "") === "/p/ws" ? ["/p/ws/a.md"] : [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    // A second, fileless folder tab must survive the reload sweep untouched.
    await act(async () => {
      await result.current.openFolder("/p/empty");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/ws/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const folder = result.current.tabs.find((t) => t.id === folderId);
    expect(folder?.kind === "folder" ? folder.file?.content : null).toBe("v2");
  });
});

describe("useTabs directory-changed events", () => {
  it("refreshes the folder tree and rebuilds the workspace indices", async () => {
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
    // An unrelated file tab that the refresh must leave alone. Opened first so
    // the folder tab stays active for the workspaceFiles assertion below.
    await act(async () => {
      await result.current.openFile("/p/solo.md");
    });
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const folderId = result.current.tabs.find((t) => t.kind === "folder")!.id;
    // Load a subdirectory so the refresh sweep covers cached child listings too.
    await act(async () => {
      await result.current.toggleExpand(folderId, "/p/ws/sub");
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

    const folder = result.current.tabs.find((t) => t.id === folderId);
    const rootListing = folder?.kind === "folder" ? folder.nodes.get("/p/ws") : null;
    expect(rootListing?.some((e) => e.path === "/p/ws/new.md")).toBe(true);
    expect(folder?.kind === "folder" ? folder.nodes.has("/p/ws/sub") : false).toBe(true);
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
