import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOptions, makeInvoker, resetTabsMocks } from "@/test/tabsHarness";
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

  it("renamePath keeps the navigation history pointing at the renamed note", async () => {
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
});
