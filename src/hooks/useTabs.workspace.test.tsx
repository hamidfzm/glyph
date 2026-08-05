import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureListener,
  defaultOptions,
  fileScan,
  type Invoker,
  makeInvoker,
  metadataScan,
  resetTabsMocks,
  watchDirectoryCalls,
  wikilinkScan,
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

describe("useTabs workspace lifecycle", () => {
  it("opening another folder replaces the workspace and closes its tabs", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan([]),
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
        list_markdown_files: async () => fileScan(["/p/ws/note.md"]),
        scan_wikilinks: async () =>
          wikilinkScan([{ source: "/p/ws/note.md", target: "x", line: 1, snippet: "[[x]]" }]),
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

    await act(async () => {
      await result.current.closeWorkspace();
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

    await act(async () => {
      await result.current.closeWorkspace();
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
      await result.current.closeWorkspace();
    });

    expect(result.current.workspace).toBeNull();
    expect(result.current.tabs).toHaveLength(0);
  });

  it("drops a stale metadata scan that lands after the workspace was replaced", async () => {
    let releaseStale: ((scan: unknown) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        scan_metadata: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/a") {
            return new Promise((resolve) => {
              releaseStale = resolve;
            });
          }
          return Promise.resolve(metadataScan([]));
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
      releaseStale?.(metadataScan([{ path: "/p/a/x.md", frontmatter: null, tags: ["work"] }]));
      await Promise.resolve();
    });

    // The slow scan for the replaced workspace must not clobber /p/b's index.
    expect(result.current.metadataEntries).toEqual([]);
  });

  it("drops a stale wikilink scan that lands after the workspace was replaced", async () => {
    let releaseStale: ((scan: unknown) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        scan_wikilinks: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/a") {
            return new Promise((resolve) => {
              releaseStale = resolve;
            });
          }
          return Promise.resolve(wikilinkScan([]));
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
      releaseStale?.(
        wikilinkScan([{ source: "/p/a/x.md", target: "y", line: 1, snippet: "[[y]]" }]),
      );
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
      await result.current.closeWorkspace();
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
    let release: ((scan: unknown) => void) | null = null;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/ws") {
            return new Promise((resolve) => {
              release = resolve;
            });
          }
          return Promise.resolve(fileScan([]));
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
      release?.(fileScan([]));
      release = null;
      await opening;
    });

    await act(async () => {
      dirChanged.handler?.({ payload: "/p/ws" });
      // Past the refresh debounce: the handler is now parked on the index read.
      await new Promise((r) => setTimeout(r, 350));
      result.current.closeWorkspace();
      release?.(fileScan([]));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.workspace).toBeNull();
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
