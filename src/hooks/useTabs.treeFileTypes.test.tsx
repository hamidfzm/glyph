import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Disposer } from "@/lib/plugins/disposer";
import { registerFileType } from "@/lib/plugins/fileTypes";
import type { DirEntry } from "@/lib/tabs";
import { type Deferred, deferred } from "@/test/deferred";
import { defaultOptions, makeInvoker, resetTabsMocks, type TabsHook } from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

const entry = (path: string, isDirectory = false): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDirectory,
  modified: 0,
});

const DISK: Record<string, DirEntry[]> = {
  "/p/ws": [entry("/p/ws/sub", true), entry("/p/ws/a.md"), entry("/p/ws/sketch.excalidraw")],
  "/p/ws/sub": [entry("/p/ws/sub/plan.excalidraw")],
};

/** What the backend lists: folders, markdown, and the extensions it is passed. */
function listing(path: string, extensions: string[]): DirEntry[] {
  return (DISK[path] ?? []).filter((e) => {
    const ext = e.name.slice(e.name.lastIndexOf(".") + 1);
    return e.isDirectory || ext === "md" || extensions.includes(ext);
  });
}

let held: { path: string; gate: Deferred; started: Deferred } | null = null;

/** Park the next read of `path` until the returned gate resolves. */
function holdRead(path: string) {
  held = { path, gate: deferred(), started: deferred() };
  return held;
}

const disposers: Disposer[] = [];
function registerExcalidraw() {
  disposers.push(registerFileType({ extensions: ["excalidraw"], language: "excalidraw" }));
}

beforeEach(() => {
  resetTabsMocks();
  held = null;
  vi.mocked(invoke).mockImplementation(
    makeInvoker({
      read_directory: async (_cmd, args) => {
        const path = String(args?.path);
        // The listing is decided by what the call carried, as in Rust.
        const result = listing(path, args?.extensions as string[]);
        const hold = held;
        if (hold?.path === path) {
          held = null;
          hold.started.resolve();
          await hold.gate.promise;
        }
        return result;
      },
    }) as typeof invoke,
  );
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

const names = (result: TabsHook, dir: string) =>
  result.current.workspace?.nodes.get(dir)?.map((e) => e.name);

async function openWorkspace() {
  const { result } = renderHook(() => useTabs(defaultOptions()));
  await waitFor(() => expect(result.current.initializing).toBe(false));
  return result;
}

describe("useTabs file tree and plugin file types", () => {
  it("passes the registered extensions and lists their files", async () => {
    registerExcalidraw();
    const result = await openWorkspace();

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(invoke).toHaveBeenCalledWith("read_directory", {
      path: "/p/ws",
      extensions: ["excalidraw"],
    });
    expect(names(result, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
  });

  it("re-reads the loaded folders when a file type registers and when it goes away", async () => {
    const result = await openWorkspace();
    await act(async () => {
      await result.current.openFolder("/p/ws");
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(names(result, "/p/ws")).toEqual(["sub", "a.md"]);
    expect(names(result, "/p/ws/sub")).toEqual([]);

    act(registerExcalidraw);
    await waitFor(() => expect(names(result, "/p/ws")).toContain("sketch.excalidraw"));
    await waitFor(() => expect(names(result, "/p/ws/sub")).toEqual(["plan.excalidraw"]));

    act(() => {
      for (const dispose of disposers.splice(0)) dispose();
    });
    await waitFor(() => expect(names(result, "/p/ws")).toEqual(["sub", "a.md"]));
    await waitFor(() => expect(names(result, "/p/ws/sub")).toEqual([]));
  });

  it("reads a folder again when a file type registers while the workspace opens", async () => {
    // A launch opens its folder without waiting for plugins.
    const result = await openWorkspace();
    const hold = holdRead("/p/ws");

    await act(async () => {
      const opening = result.current.openFolder("/p/ws");
      await hold.started.promise;
      registerExcalidraw();
      hold.gate.resolve();
      await opening;
    });

    expect(names(result, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
  });

  it.each([
    ["expanding a folder", (hook: TabsHook) => hook.current.toggleExpand("/p/ws/sub")],
    ["expanding every folder", (hook: TabsHook) => hook.current.expandAll()],
  ])("keeps a refresh that lands while %s", async (_, expand) => {
    const result = await openWorkspace();
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const hold = holdRead("/p/ws/sub");

    await act(async () => {
      const expanding = expand(result);
      await hold.started.promise;
      registerExcalidraw();
      // The refresh of the root reads at once and queues its listing first.
      await new Promise((r) => setTimeout(r, 0));
      hold.gate.resolve();
      await expanding;
    });

    expect(names(result, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
    expect(names(result, "/p/ws/sub")).toEqual(["plan.excalidraw"]);
  });
});
