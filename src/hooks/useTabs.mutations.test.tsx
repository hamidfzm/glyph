import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPathInside, movedPath } from "@/lib/paths";
import { EDITOR_MODE } from "@/lib/settings";
import type { Relink } from "@/lib/vault";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import {
  captureListener,
  changeOnDisk,
  defaultOptions,
  deliver,
  fileOf,
  makeInvoker,
  resetTabsMocks,
  type TabsHook,
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

/** What `rename_path` and `move_path` report; by default nothing links to the entry. */
const relinked = (newPath: string, over: Partial<Relink> = {}): Relink => ({
  newPath,
  files: [],
  failed: null,
  ...over,
});

/** Whether `command` ran for real rather than as a dry run. */
const applied = (command: string) =>
  vi
    .mocked(invoke)
    .mock.calls.some(
      ([cmd, args]) => cmd === command && (args as { dryRun?: boolean }).dryRun === false,
    );

async function openWorkspace(result: TabsHook) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  await act(async () => {
    await result.current.openFolder("/p/ws");
  });
}

/** Open `path` in edit mode with a typed, unsaved change. */
async function openDirty(result: TabsHook, path: string, edit: string) {
  await act(async () => {
    await result.current.openFile(path);
  });
  const tabId = result.current.tabs[0].id;
  act(() => {
    result.current.setTabMode(tabId, EDITOR_MODE.edit);
    result.current.updateEditContent(tabId, edit);
  });
}

describe("useTabs renaming, moving and deleting", () => {
  it("deletePath confirms, invokes delete_path, and refreshes", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        delete_path: async () => undefined,
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);

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
    await openWorkspace(result);

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
    await openWorkspace(result);
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
    await openWorkspace(result);

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
        rename_path: async () => relinked("/p/ws/renamed.md"),
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
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

  it("renamePath keeps the navigation history pointing at the renamed note", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => relinked("/p/ws/renamed.md"),
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/other.md");
    });
    await act(async () => {
      await result.current.renamePath("/p/ws/note.md", "renamed");
    });

    await act(async () => {
      result.current.navigateBack();
    });
    expect(result.current.activeFile?.path).toBe("/p/ws/renamed.md");
    expect(result.current.tabs).toHaveLength(2);
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
        rename_path: async () => relinked("/p/ws/renamed.md"),
        unwatch_file: boomWhenArmed,
        watch_file: boomWhenArmed,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
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
        move_path: async () => relinked("/p/ws/sub/note.md"),
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);

    let newPath: string | null = null;
    await act(async () => {
      newPath = await result.current.movePath("/p/ws/note.md", "/p/ws/sub");
    });

    expect(newPath).toBe("/p/ws/sub/note.md");
    expect(invoke).toHaveBeenCalledWith("move_path", {
      from: "/p/ws/note.md",
      toDir: "/p/ws/sub",
      root: "/p/ws",
      dryRun: false,
    });
  });

  it("movePath re-points open tabs inside the moved folder", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => relinked("/p/ws/dest/sub"),
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
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
        move_path: async () => relinked("/p/ws/note.md"),
        read_directory: async () => [],
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);

    let p: string | null = null;
    await act(async () => {
      p = await result.current.movePath("/p/ws/note.md", "/p/ws");
    });
    expect(p).toBe("/p/ws/note.md");
  });

  it("movePath prunes cached listings under the moved folder", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () => relinked("/p/ws/dest/sub"),
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
    await openWorkspace(result);
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
    await openWorkspace(result);
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
    await openWorkspace(result);

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
    await openWorkspace(result);
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

  it("rename/duplicate/move are no-ops when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let r: string | null = "x";
    let d: string | null = "x";
    let mv: string | null = "x";
    await act(async () => {
      r = await result.current.renamePath("/p/ws/a.md", "b");
      d = await result.current.duplicatePath("/p/ws/a.md");
      mv = await result.current.movePath("/p/ws/a.md", "/p/ws/sub");
    });
    expect([r, d, mv]).toEqual([null, null, null]);
  });
});

describe("useTabs link rewriting on rename and move", () => {
  const index = [{ path: "/p/ws/index.md", links: 2 }];

  it("asks before a rewrite and changes nothing when the user backs out", async () => {
    const confirmRelink = vi.fn(async () => false);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => relinked("/p/ws/trip.md", { files: index }),
        move_path: async () => relinked("/p/ws/dest/travel.md", { files: index }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ confirmRelink })));
    await openWorkspace(result);

    let renamed: string | null = "unset";
    let moved: string | null = "unset";
    await act(async () => {
      renamed = await result.current.renamePath("/p/ws/travel.md", "trip");
      moved = await result.current.movePath("/p/ws/travel.md", "/p/ws/dest");
    });

    expect([renamed, moved]).toEqual([null, null]);
    expect(confirmRelink).toHaveBeenCalledWith({ root: "/p/ws", files: index, unsaved: [] });
    expect(applied("rename_path")).toBe(false);
    expect(applied("move_path")).toBe(false);
  });

  it("drops a rename confirmed after the workspace changed behind the prompt", async () => {
    let switchWorkspace: () => Promise<unknown> = async () => {};
    const confirmRelink = vi.fn(async () => {
      await switchWorkspace();
      return true;
    });
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        rename_path: async () => relinked("/p/ws/trip.md", { files: index }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ confirmRelink })));
    await openWorkspace(result);
    switchWorkspace = () => result.current.openFolder("/p/other");

    let renamed: string | null = "unset";
    await act(async () => {
      renamed = await result.current.renamePath("/p/ws/travel.md", "trip");
    });

    expect(renamed).toBeNull();
    expect(applied("rename_path")).toBe(false);
    expect(result.current.workspace?.root).toBe("/p/other");
  });

  it("renames without asking when nothing links to the note", async () => {
    const confirmRelink = vi.fn(async () => true);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ rename_path: async () => relinked("/p/ws/trip.md") }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ confirmRelink })));
    await openWorkspace(result);

    await act(async () => {
      await result.current.renamePath("/p/ws/travel.md", "trip");
    });

    expect(confirmRelink).not.toHaveBeenCalled();
    expect(applied("rename_path")).toBe(true);
  });

  it("saves an affected tab before the rewrite, then reloads it and refreshes the index", async () => {
    let disk = "see [[travel]]";
    const steps: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => disk,
        write_file: async (_cmd, args) => {
          steps.push("save");
          disk = String(args?.content);
        },
        rename_path: async (_cmd, args) => {
          steps.push(args?.dryRun ? "preview" : "apply");
          if (!args?.dryRun) disk = disk.replace("[[travel]]", "[[trip]]");
          return relinked("/p/ws/trip.md", { files: [{ path: "/p/ws/index.md", links: 1 }] });
        },
        vault_snapshot: async () => {
          steps.push("index");
          return vaultSnapshot();
        },
      }) as typeof invoke,
    );
    const confirmRelink = vi.fn(async () => true);
    const { result } = renderHook(() => useTabs(defaultOptions({ confirmRelink })));
    await openWorkspace(result);
    await openDirty(result, "/p/ws/index.md", "see [[travel]] and more");
    steps.length = 0;

    await act(async () => {
      await result.current.renamePath("/p/ws/travel.md", "trip");
    });

    expect(confirmRelink).toHaveBeenCalledWith({
      root: "/p/ws",
      files: [{ path: "/p/ws/index.md", links: 1 }],
      unsaved: ["/p/ws/index.md"],
    });
    expect(steps).toEqual(["preview", "save", "apply", "index"]);
    await waitFor(() => expect(fileOf(result).editContent).toBe("see [[trip]] and more"));
    expect(fileOf(result).content).toBe("see [[trip]] and more");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("does not rename when an affected tab cannot be saved", async () => {
    expectConsole(/Auto-save failed/);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        write_file: async () => {
          throw new Error("disk full");
        },
        rename_path: async () => relinked("/p/ws/trip.md", { files: index }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
    await openDirty(result, "/p/ws/index.md", "typed");

    let renamed: string | null = "unset";
    await act(async () => {
      renamed = await result.current.renamePath("/p/ws/travel.md", "trip");
    });

    expect(renamed).toBeNull();
    expect(applied("rename_path")).toBe(false);
    expect(fileOf(result).dirty).toBe(true);
  });

  it("reloads the moved note itself when its own links were rewritten", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async (_cmd, args) =>
          args?.path === "/p/ws/dest/travel.md" ? "![map](../map.png)" : "![map](map.png)",
        move_path: async () =>
          relinked("/p/ws/dest/travel.md", {
            files: [{ path: "/p/ws/dest/travel.md", links: 1 }],
          }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);
    await act(async () => {
      await result.current.openFile("/p/ws/travel.md");
    });

    await act(async () => {
      await result.current.movePath("/p/ws/travel.md", "/p/ws/dest");
    });

    await waitFor(() => expect(fileOf(result).content).toBe("![map](../map.png)"));
    expect(fileOf(result).path).toBe("/p/ws/dest/travel.md");
  });

  it("drops a watcher read of a rewritten file that began before the rewrite", async () => {
    const staleRead = deferred<string>();
    const reads = ["see [[travel]]", staleRead.promise, "see [[trip]]"];
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => reads.shift(),
        rename_path: async () => relinked("/p/ws/trip.md", { files: index }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await openWorkspace(result);
    await act(async () => {
      await result.current.openFile("/p/ws/index.md");
    });

    // The watcher's read is still out when the rename rewrites the file.
    await changeOnDisk(fileChanged, "/p/ws/index.md");
    await act(async () => {
      await result.current.renamePath("/p/ws/travel.md", "trip");
    });
    await waitFor(() => expect(fileOf(result).content).toBe("see [[trip]]"));
    await deliver(() => staleRead.resolve("see [[travel]]"));

    expect(fileOf(result).content).toBe("see [[trip]]");
  });

  it("drops a watcher read that arrives before the rewrite's own reload", async () => {
    const staleRead = deferred<string>();
    const ownReload = deferred<string>();
    const reads = ["see [[travel]]", staleRead.promise, ownReload.promise];
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => reads.shift(),
        rename_path: async () => relinked("/p/ws/trip.md", { files: index }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await openWorkspace(result);
    await act(async () => {
      await result.current.openFile("/p/ws/index.md");
    });

    await changeOnDisk(fileChanged, "/p/ws/index.md");
    let renaming: Promise<string | null> | undefined;
    act(() => {
      renaming = result.current.renamePath("/p/ws/travel.md", "trip");
    });
    await waitFor(() => expect(reads).toHaveLength(0));
    // No newer read has landed yet, so only the mark on the rewritten file drops this one.
    await deliver(() => staleRead.resolve("theirs"));
    expect(fileOf(result).content).toBe("see [[travel]]");

    await act(async () => {
      ownReload.resolve("see [[trip]]");
      await renaming;
    });
    expect(fileOf(result).content).toBe("see [[trip]]");
  });

  it("names the file a rewrite stopped at and reads back only open files", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        move_path: async () =>
          relinked("/p/ws/dest/travel.md", {
            files: [{ path: "/p/ws/a.md", links: 1 }],
            failed: { path: "/p/ws/notes/b.md", error: "Access is denied." },
          }),
      }) as typeof invoke,
    );
    expectConsole(/Failed to update links/);
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await openWorkspace(result);

    let moved: string | null = null;
    await act(async () => {
      moved = await result.current.movePath("/p/ws/travel.md", "/p/ws/dest");
    });

    expect(moved).toBe("/p/ws/dest/travel.md");
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.relinkFailed", values: { name: "b.md" } },
      { persistent: true },
    );
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/ws/a.md" });
  });

  it("returns null when the backend refuses a rename or a move", async () => {
    const refuse = async () => {
      throw new Error("Refusing to write outside the workspace");
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ rename_path: refuse, move_path: refuse }) as typeof invoke,
    );
    expectConsole(/Failed to rename/, /Failed to move/);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await openWorkspace(result);

    let renamed: string | null = "unset";
    let moved: string | null = "unset";
    await act(async () => {
      renamed = await result.current.renamePath("/p/ws/travel.md", "trip");
      moved = await result.current.movePath("/p/ws/travel.md", "/p/ws/dest");
    });

    expect([renamed, moved]).toEqual([null, null]);
  });
});

describe("useTabs reloads across a rename or move", () => {
  const NOTE = "/p/ws/note.md";
  const RENAMED = "/p/ws/renamed.md";

  /**
   * A disk where a rename or move really moves `from` to `to`, so a read of an
   * old path fails. `onMoved` runs before the command answers, which is when
   * the watcher reports the move.
   */
  function movableDisk(
    files: Record<string, string>,
    from: string,
    to: string,
    onMoved = () => {},
  ) {
    const disk = new Map(Object.entries(files));
    const relocate = async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.dryRun) return relinked(to);
      for (const [path, body] of [...disk]) {
        if (!isPathInside(path, from)) continue;
        disk.delete(path);
        disk.set(movedPath(path, from, to), body);
      }
      onMoved();
      return relinked(to);
    };
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async (_cmd, args) => {
          const body = disk.get(String(args?.path));
          if (body === undefined) throw new Error("No such file");
          return body;
        },
        rename_path: relocate,
        move_path: relocate,
      }) as typeof invoke,
    );
    return disk;
  }

  type FileChanged = ReturnType<typeof captureListener>;

  /** Report a change to each path, then run `action` before the debounce can end. */
  async function reportThen(
    fileChanged: FileChanged,
    paths: string[],
    action: () => Promise<unknown>,
  ) {
    // One act: no timer can fire between the report and the action, however slow the run.
    await act(async () => {
      for (const path of paths) fileChanged.handler?.({ payload: path });
      await action();
    });
  }

  async function waitOutDebounce() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
  }

  async function openNote() {
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoReload: true, autoSave: false })),
    );
    await openWorkspace(result);
    await act(async () => {
      await result.current.openFile(NOTE);
    });
    return { result, tabId: result.current.tabs[0].id };
  }

  it.each([
    ["renamed", RENAMED, (tabs: TabsHook) => tabs.current.renamePath(NOTE, "renamed")],
    ["moved", "/p/ws/dest/note.md", (tabs: TabsHook) => tabs.current.movePath(NOTE, "/p/ws/dest")],
  ])("reloads a tab %s before its reported change was read", async (_how, newPath, relocate) => {
    const disk = movableDisk({ [NOTE]: "v1" }, NOTE, newPath);
    const fileChanged = captureListener("file-changed");
    const { result } = await openNote();

    disk.set(NOTE, "v2");
    await reportThen(fileChanged, [NOTE], () => relocate(result));
    await waitOutDebounce();

    expect(fileOf(result)).toMatchObject({ path: newPath, content: "v2" });
  });

  it("reloads each tab of a folder moved before their reported changes were read", async () => {
    const inFolder = ["/p/ws/dir/a.md", "/p/ws/dir/b.md"];
    const disk = movableDisk(
      { [inFolder[0]]: "a1", [inFolder[1]]: "b1", "/p/ws/c.md": "c1" },
      "/p/ws/dir",
      "/p/ws/dest/dir",
    );
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await openWorkspace(result);
    for (const path of [...inFolder, "/p/ws/c.md"]) {
      await act(async () => {
        await result.current.openFile(path);
      });
    }

    disk.set(inFolder[0], "a2");
    disk.set(inFolder[1], "b2");
    // Never reported, so the tab outside the folder must not pick this up.
    disk.set("/p/ws/c.md", "c2");
    await reportThen(fileChanged, inFolder, () =>
      result.current.movePath("/p/ws/dir", "/p/ws/dest"),
    );
    await waitOutDebounce();

    expect(fileOf(result, 0)).toMatchObject({ path: "/p/ws/dest/dir/a.md", content: "a2" });
    expect(fileOf(result, 1)).toMatchObject({ path: "/p/ws/dest/dir/b.md", content: "b2" });
    expect(fileOf(result, 2)).toMatchObject({ path: "/p/ws/c.md", content: "c1" });
  });

  it("keeps the reload owed to a renamed tab when its old path reports the rename", async () => {
    const disk = movableDisk({ [NOTE]: "v1" }, NOTE, RENAMED);
    const fileChanged = captureListener("file-changed");
    const { result } = await openNote();

    disk.set(NOTE, "v2");
    await reportThen(fileChanged, [NOTE], () => result.current.renamePath(NOTE, "renamed"));
    // The watcher reports a rename as a change to the path it was watching.
    await changeOnDisk(fileChanged, NOTE);

    expect(fileOf(result)).toMatchObject({ path: RENAMED, content: "v2" });
  });

  it("keeps the undo stack when a rename's own report re-reads unchanged text", async () => {
    const fileChanged = captureListener("file-changed");
    // The report arrives while the tab is still on its old path, as it does in the app.
    const disk = movableDisk({ [NOTE]: "- [ ] task" }, NOTE, RENAMED, () =>
      fileChanged.handler?.({ payload: NOTE }),
    );
    const { result, tabId } = await openNote();
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    disk.set(NOTE, "- [x] task");
    // Long after the toggle, so its self-save grace cannot be what skips the reload.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 5000);

    await act(async () => {
      await result.current.renamePath(NOTE, "renamed");
    });
    await waitOutDebounce();
    expect(invoke).toHaveBeenCalledWith("read_file", { path: RENAMED });
    await act(async () => {
      await result.current.undoEdit(tabId);
    });

    expect(fileOf(result)).toMatchObject({ path: RENAMED, content: "- [ ] task" });
  });

  it("skips the echo of a save made before the tab was renamed", async () => {
    movableDisk({ [NOTE]: "- [ ] task" }, NOTE, RENAMED);
    const fileChanged = captureListener("file-changed");
    const { result, tabId } = await openNote();

    // The mock disk never receives the toggle, so a reload would put the box back.
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    await reportThen(fileChanged, [NOTE], () => result.current.renamePath(NOTE, "renamed"));
    await waitOutDebounce();

    expect(fileOf(result)).toMatchObject({ path: RENAMED, content: "- [x] task" });
  });

  it("skips a pending change when the renamed tab was saved since", async () => {
    const disk = movableDisk({ [NOTE]: "v1" }, NOTE, RENAMED);
    const fileChanged = captureListener("file-changed");
    const { result, tabId } = await openNote();
    act(() => {
      result.current.setTabMode(tabId, EDITOR_MODE.edit);
      result.current.updateEditContent(tabId, "mine");
    });

    // The mock disk keeps "theirs", so a reload after the save would replace "mine".
    disk.set(NOTE, "theirs");
    await reportThen(fileChanged, [NOTE], () => result.current.renamePath(NOTE, "renamed"));
    await act(async () => {
      await result.current.saveDocument(tabId);
    });
    await waitOutDebounce();

    expect(fileOf(result)).toMatchObject({ path: RENAMED, content: "mine", dirty: false });
  });

  it("reads nothing for a tab renamed to an image before the debounce ended", async () => {
    const disk = movableDisk({ [NOTE]: "v1" }, NOTE, "/p/ws/note.png");
    const fileChanged = captureListener("file-changed");
    const { result } = await openNote();

    disk.set(NOTE, "v2");
    await reportThen(fileChanged, [NOTE], () => result.current.renamePath(NOTE, "note.png"));
    await waitOutDebounce();

    expect(fileOf(result).path).toBe("/p/ws/note.png");
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/ws/note.png" });
  });
});
