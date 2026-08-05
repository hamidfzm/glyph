import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
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

describe("useTabs creating entries", () => {
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

  it("createNoteInWorkspace creates a note at the root and opens it in edit mode", async () => {
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
        read_file: async () => "",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // A second open tab so the mode-switch walk also visits a non-matching tab.
    await act(async () => {
      await result.current.openFile("/p/ws/other.md");
    });

    await act(async () => {
      await result.current.createNoteInWorkspace();
    });

    expect(invoke).toHaveBeenCalledWith("create_note", { dir: "/p/ws", root: "/p/ws" });
    const tab = result.current.tabs.find(
      (t) => t.kind === "file" && t.file.path === "/p/ws/Untitled.md",
    );
    expect(tab).toBeTruthy();
    if (tab?.kind === "file") {
      expect(tab.file.mode).toBe("edit");
    }
    // The pre-existing note is untouched (stayed in its default view mode).
    const other = result.current.tabs.find(
      (t) => t.kind === "file" && t.file.path === "/p/ws/other.md",
    );
    if (other?.kind === "file") {
      expect(other.file.mode).toBe("view");
    }
  });

  it("createNoteInWorkspace does nothing when the note cannot be created", async () => {
    expectConsole(/Failed to create note/);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        create_note: async () => {
          throw new Error("permission denied");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const before = result.current.tabs.length;

    await act(async () => {
      await result.current.createNoteInWorkspace();
    });

    expect(result.current.tabs).toHaveLength(before);
  });

  it("createCanvasInWorkspace creates a board at the root and opens it in edit mode", async () => {
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
        read_file: async () => "{}",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await act(async () => {
      await result.current.createCanvasInWorkspace();
    });

    expect(invoke).toHaveBeenCalledWith("create_canvas", { dir: "/p/ws", root: "/p/ws" });
    const tab = result.current.tabs.find(
      (t) => t.kind === "file" && t.file.path === "/p/ws/Untitled.canvas",
    );
    expect(tab).toBeTruthy();
    // A new board is empty, so it must not open in the read-only canvas view.
    if (tab?.kind === "file") expect(tab.file.mode).toBe("edit");
  });

  it("createNoteInWorkspace is a no-op without a workspace", async () => {
    const createNote = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ create_note: createNote as unknown as Invoker }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.createNoteInWorkspace();
    });

    expect(createNote).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(0);
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
});
