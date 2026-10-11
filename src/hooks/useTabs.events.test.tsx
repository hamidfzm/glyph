import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import type { NoteSummary } from "@/lib/vault";
import { type Deferred, deferred } from "@/test/deferred";
import {
  captureListener,
  changeOnDisk,
  defaultOptions,
  deliver,
  fileOf,
  fileScan,
  makeInvoker,
  openEditable,
  resetTabsMocks,
  vaultSnapshot,
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

/** One file on disk: a read answers whatever the app, or the test as another program, wrote last. */
function mockDisk(text: string) {
  const disk = { text };
  vi.mocked(invoke).mockImplementation(
    makeInvoker({
      read_file: async () => disk.text,
      write_file: async (_cmd, args) => {
        disk.text = String(args?.content);
      },
    }) as typeof invoke,
  );
  return disk;
}

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

  it("changes nothing for the echo of its own write, then reloads what another program wrote", async () => {
    const disk = mockDisk("- [ ] task");
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    await act(async () => {
      await result.current.toggleTask(result.current.tabs[0].id, 1);
    });

    // The watcher reports the toggle's own write: the disk holds what the tab shows.
    const tabs = result.current.tabs;
    await changeOnDisk(fileChanged, "/p/tasks.md");
    expect(result.current.tabs).toBe(tabs);

    // Another program writes while the toggle is still recent.
    disk.text = "- [x] task\n- [ ] added elsewhere";
    await changeOnDisk(fileChanged, "/p/tasks.md");
    expect(fileOf(result).content).toBe("- [x] task\n- [ ] added elsewhere");
  });

  it.each(Object.values(EDITOR_MODE))(
    "reloads what another program wrote right after a save, in %s mode",
    async (mode) => {
      const disk = mockDisk("v1");
      const fileChanged = captureListener("file-changed");
      const { result } = renderHook(() =>
        useTabs(defaultOptions({ autoReload: true, autoSave: false })),
      );
      const tabId = await openEditable(result);
      act(() => {
        result.current.updateEditContent(tabId, "mine");
        result.current.setTabMode(tabId, mode);
      });
      await act(async () => {
        await result.current.saveDocument(tabId);
      });
      expect(disk.text).toBe("mine");

      // A formatter rewrites the file as soon as the save lands.
      disk.text = "theirs";
      await changeOnDisk(fileChanged, "/p/a.md");

      expect(fileOf(result)).toMatchObject({
        content: "theirs",
        editContent: "theirs",
        dirty: false,
      });
    },
  );

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

  it("reloads every file changed within one debounce window", async () => {
    const bodies: Record<string, string> = { "/p/a.md": "a1", "/p/b.md": "b1" };
    const reads: string[] = [];
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async (_cmd, args) => {
          const path = String(args?.path ?? "");
          reads.push(path);
          return bodies[path];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
      await result.current.openFile("/p/b.md");
    });

    // A git checkout rewrites both files in one burst; a repeat event for the
    // same path still collapses into a single reload.
    bodies["/p/a.md"] = "a2";
    bodies["/p/b.md"] = "b2";
    reads.length = 0;
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      fileChanged.handler?.({ payload: "/p/b.md" });
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(fileOf(result, 0).content).toBe("a2");
    expect(fileOf(result, 1).content).toBe("b2");
    expect(reads.sort()).toEqual(["/p/a.md", "/p/b.md"]);
  });

  it("refreshes the edit buffer of a clean edit-mode tab so the reload renders", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    // Entering edit mode seeds editContent from content; the tab stays clean.
    act(() => {
      result.current.setTabMode(result.current.tabs[0].id, EDITOR_MODE.edit);
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.content : null).toBe("v2");
    // TabContent renders `editContent ?? content`, so a stale buffer would keep
    // showing v1 in both the editor and the split preview.
    expect(tab.kind === "file" ? tab.file.editContent : null).toBe("v2");
  });

  it("keeps the unsaved buffer of a dirty edit-mode tab", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoReload: true, autoSave: false })),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;
    act(() => {
      result.current.setTabMode(tabId, EDITOR_MODE.edit);
      result.current.updateEditContent(tabId, "my unsaved work");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.editContent : null).toBe("my unsaved work");
    expect(tab.kind === "file" ? tab.file.content : null).toBe("v1");
  });

  it("keeps the unsaved buffer of a dirty tab switched back to view mode", async () => {
    let body = "v1";
    let reads = 0;
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => {
          reads += 1;
          return body;
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoReload: true, autoSave: false })),
    );
    const tabId = await openEditable(result);
    // Leaving the editor neither saves nor clears the dirty flag.
    act(() => {
      result.current.updateEditContent(tabId, "my unsaved work");
      result.current.setTabMode(tabId, EDITOR_MODE.view);
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    // The reload ran and read the file, so it is the guard that kept the buffer.
    expect(reads).toBe(2);
    expect(fileOf(result).editContent).toBe("my unsaved work");
    expect(fileOf(result).content).toBe("v1");

    await act(async () => {
      await result.current.saveDocument(tabId);
    });
    expect(invoke).toHaveBeenCalledWith("write_file", {
      path: "/p/a.md",
      content: "my unsaved work",
    });
  });
});

/** Answers the read that opens the tab, then parks every reload for the test to settle. */
function parkReloads(opened: string) {
  const reloads: Deferred<string>[] = [];
  let isOpen = false;
  vi.mocked(invoke).mockImplementation(
    makeInvoker({
      read_file: () => {
        if (!isOpen) {
          isOpen = true;
          return Promise.resolve(opened);
        }
        const reload = deferred<string>();
        reloads.push(reload);
        return reload.promise;
      },
    }) as typeof invoke,
  );
  return reloads;
}

describe("useTabs reloads overtaken by a save or a newer reload", () => {
  it.each(Object.values(EDITOR_MODE))(
    "does not apply a read a save overtook, in %s mode",
    async (mode) => {
      const reloads = parkReloads("v1");
      const fileChanged = captureListener("file-changed");
      const { result } = renderHook(() =>
        useTabs(defaultOptions({ autoReload: true, autoSave: false })),
      );
      const tabId = await openEditable(result);
      act(() => {
        result.current.updateEditContent(tabId, "mine");
        result.current.setTabMode(tabId, mode);
      });

      // The read that will answer "theirs" is still out when the save puts "mine" on disk.
      await changeOnDisk(fileChanged, "/p/a.md");
      expect(reloads).toHaveLength(1);
      await act(async () => {
        await result.current.saveDocument(tabId);
      });
      await deliver(() => reloads[0].resolve("theirs"));

      expect(fileOf(result)).toMatchObject({ content: "mine", editContent: "mine", dirty: false });
      expect(reloads).toHaveLength(2);
    },
  );

  it("reads again after a save overtook the read, and applies what another program wrote since", async () => {
    const reloads = parkReloads("v1");
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoReload: true, autoSave: false })),
    );
    const tabId = await openEditable(result);

    // The tab is clean when the read starts, then is edited and saved before it answers.
    await changeOnDisk(fileChanged, "/p/a.md");
    act(() => {
      result.current.updateEditContent(tabId, "mine");
    });
    await act(async () => {
      await result.current.saveDocument(tabId);
    });
    // This read may have run before the save or after a later write, so its text is not used.
    await deliver(() => reloads[0].resolve("theirs"));
    expect(fileOf(result).content).toBe("mine");
    expect(reloads).toHaveLength(2);

    await deliver(() => reloads[1].resolve("theirs"));
    expect(fileOf(result)).toMatchObject({
      content: "theirs",
      editContent: "theirs",
      dirty: false,
    });
  });

  it("does not apply a read that a checklist toggle in view mode overtook", async () => {
    const reloads = parkReloads("- [ ] task");
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    // A view-mode toggle writes straight to disk without marking the tab dirty.
    await changeOnDisk(fileChanged, "/p/a.md");
    expect(reloads).toHaveLength(1);
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    await deliver(() => reloads[0].resolve("theirs"));

    expect(fileOf(result).content).toBe("- [x] task");
    expect(reloads).toHaveLength(2);
  });

  it("keeps the newer of two reads when the older one arrives last", async () => {
    const reloads = parkReloads("v1");
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    // The first read outlives the debounce, so a second change starts another.
    await changeOnDisk(fileChanged, "/p/a.md");
    await changeOnDisk(fileChanged, "/p/a.md");
    expect(reloads).toHaveLength(2);
    await deliver(() => reloads[1].resolve("newer"));
    await deliver(() => reloads[0].resolve("older"));

    expect(fileOf(result).content).toBe("newer");
  });

  it("applies the older read when the newer one fails", async () => {
    const reloads = parkReloads("v1");
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await changeOnDisk(fileChanged, "/p/a.md");
    await changeOnDisk(fileChanged, "/p/a.md");
    await deliver(() => reloads[1].reject(new Error("io error")));
    await deliver(() => reloads[0].resolve("older"));

    expect(fileOf(result).content).toBe("older");
  });
});

// Only /p/ws is indexed; any other root answers empty, which is what proves a
// late refresh never lands on the workspace that replaced it.
function forRoot(root: string) {
  return root === "/p/ws"
    ? vaultSnapshot(["/p/ws/a.md"], {
        notes: [{ path: "/p/ws/a.md", title: null, tags: ["work"], fields: {} }],
      })
    : vaultSnapshot([]);
}

describe("useTabs directory-changed events", () => {
  it("refreshes the workspace tree and rebuilds the workspace indices", async () => {
    const dirChanged = captureListener("directory-changed");
    let files: string[] = [];
    let notes: NoteSummary[] = [];
    let rootEntries = [{ name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 }];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) =>
          String(args?.path ?? "") === "/p/ws" ? rootEntries : [],
        list_markdown_files: async () => fileScan(files),
        vault_refresh: async () => vaultSnapshot(files, { notes }),
        vault_snapshot: async () => vaultSnapshot(files, { notes }),
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
    notes = [{ path: "/p/ws/new.md", title: null, tags: ["work"], fields: {} }];
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
    expect(result.current.snapshot.notes).toEqual(notes);
  });

  it("drops a refresh that lands after the workspace was replaced", async () => {
    const dirChanged = captureListener("directory-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async (_cmd, args) =>
          fileScan(String(args?.path ?? "") === "/p/ws" ? ["/p/ws/a.md"] : []),
        vault_refresh: async (_cmd, args) => forRoot(String(args?.path ?? "")),
        vault_snapshot: async (_cmd, args) => forRoot(String(args?.path ?? "")),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await waitFor(() => expect(result.current.snapshot.notes).toHaveLength(1));

    // The rescan of /p/ws is still in flight when the window switches to
    // /p/other; its results must not land on the new workspace.
    await act(async () => {
      dirChanged.handler?.({ payload: "/p/ws" });
      await result.current.openFolder("/p/other");
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(result.current.workspace?.root).toBe("/p/other");
    expect(result.current.workspaceFiles).toEqual([]);
    expect(result.current.snapshot.notes).toEqual([]);
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
