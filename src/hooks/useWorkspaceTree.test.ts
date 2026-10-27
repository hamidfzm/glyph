import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Disposer } from "@/lib/plugins/disposer";
import { registerFileType } from "@/lib/plugins/fileTypes";
import type { DirEntry } from "@/lib/tabs";
import { type Deferred, deferred } from "@/test/deferred";
import { useWorkspaceTree } from "./useWorkspaceTree";

const entry = (path: string, isDirectory = false): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDirectory,
  modified: 0,
});

const DISK: Record<string, DirEntry[]> = {
  "/p/ws": [entry("/p/ws/sub", true), entry("/p/ws/a.md"), entry("/p/ws/sketch.excalidraw")],
  "/p/ws/sub": [entry("/p/ws/sub/deep", true), entry("/p/ws/sub/plan.excalidraw")],
  "/p/ws/sub/deep": [entry("/p/ws/sub/deep/idea.excalidraw")],
};

/** What the backend lists: folders, markdown, and the extensions it is passed. */
function listing(path: string, extensions: string[]): DirEntry[] {
  return (DISK[path] ?? []).filter((e) => {
    const ext = e.name.slice(e.name.lastIndexOf(".") + 1);
    return e.isDirectory || ext === "md" || extensions.includes(ext);
  });
}

let held: { path: string; gate: Deferred; started: Deferred } | null = null;

beforeEach(() => {
  held = null;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "read_directory") return undefined;
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
  }) as typeof invoke);
});

const disposers: Disposer[] = [];

afterEach(() => {
  // Unmount first: a disposal refreshes a mounted tree.
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
});

type Tree = { current: ReturnType<typeof useWorkspaceTree> };

const names = (tree: Tree, dir: string) =>
  tree.current.workspace?.nodes.get(dir)?.map((e) => e.name);

const reads = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "read_directory");

const tick = () => new Promise((r) => setTimeout(r, 0));

function registerExcalidraw() {
  disposers.push(registerFileType({ extensions: ["excalidraw"], language: "excalidraw" }));
}

function mountTree(): Tree {
  return renderHook(() => useWorkspaceTree({ repointOpenFiles: vi.fn() })).result;
}

async function openTree(expanded: string[] = []) {
  const tree = mountTree();
  await act(async () => {
    await tree.current.openTree("/p/ws", expanded);
  });
  return tree;
}

/**
 * Run `operation` with the read of `path` parked, register a file type, let
 * the refresh that starts land, then let the parked read finish. Each phase
 * renders before the next, as the app does between IPC reads.
 */
async function registerWhileReading(path: string, operation: () => Promise<unknown>) {
  const hold = { path, gate: deferred(), started: deferred() };
  held = hold;
  let pending: Promise<unknown> = Promise.resolve();
  await act(async () => {
    pending = operation();
    await hold.started.promise;
  });
  await act(async () => {
    registerExcalidraw();
    await tick();
  });
  await act(async () => {
    hold.gate.resolve();
    await pending;
  });
}

describe("useWorkspaceTree and plugin file types", () => {
  it("passes the registered extensions and lists their files", async () => {
    registerExcalidraw();
    const tree = await openTree();

    expect(invoke).toHaveBeenCalledWith("read_directory", {
      path: "/p/ws",
      extensions: ["excalidraw"],
    });
    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
  });

  it("re-reads the loaded folders when a file type registers and when it goes away", async () => {
    const tree = await openTree(["/p/ws/sub"]);
    expect(names(tree, "/p/ws/sub")).toEqual(["deep"]);

    act(registerExcalidraw);
    await waitFor(() => expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]));
    expect(names(tree, "/p/ws")).toContain("sketch.excalidraw");

    act(() => {
      for (const dispose of disposers.splice(0)) dispose();
    });
    await waitFor(() => expect(names(tree, "/p/ws/sub")).toEqual(["deep"]));
    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md"]);
  });

  it("refreshes once for file types registered together", async () => {
    const tree = await openTree(["/p/ws/sub"]);
    const before = reads().length;

    act(() => {
      registerExcalidraw();
      disposers.push(registerFileType({ extensions: ["puml"], language: "plantuml" }));
    });
    await waitFor(() => expect(names(tree, "/p/ws/sub")).toContain("plan.excalidraw"));

    expect(reads().length - before).toBe(2);
  });

  it.each([
    ["the root", "/p/ws"],
    ["an expanded folder", "/p/ws/sub"],
  ])("reads again when a file type registers while it opens %s", async (_, path) => {
    // A launch opens its folder without waiting for plugins.
    const tree = mountTree();

    await registerWhileReading(path, () => tree.current.openTree("/p/ws", ["/p/ws/sub"]));

    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
    expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]);
  });

  it.each([
    ["expanding a folder", "/p/ws/sub", (tree: Tree) => tree.current.toggleExpand("/p/ws/sub")],
    ["expanding every folder", "/p/ws/sub", (tree: Tree) => tree.current.expandAll()],
    ["expanding every folder, deeper", "/p/ws/sub/deep", (tree: Tree) => tree.current.expandAll()],
  ])("keeps the change's refresh and reads again while %s", async (_, path, expand) => {
    const tree = await openTree();

    await registerWhileReading(path, () => expand(tree));

    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
    expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]);
  });

  it.each([
    ["expanding a folder", (tree: Tree) => tree.current.toggleExpand("/p/ws/sub")],
    ["expanding every folder", (tree: Tree) => tree.current.expandAll()],
  ])("refreshes a folder %s wrote just before a file type registered", async (_, expand) => {
    const tree = await openTree();

    await act(async () => {
      await expand(tree);
      // Its listing is queued but not rendered yet.
      registerExcalidraw();
      await tick();
    });

    await waitFor(() => expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]));
  });

  it("drops an earlier refresh that a file type change overtook", async () => {
    const tree = await openTree(["/p/ws/sub"]);

    await registerWhileReading("/p/ws/sub", () => tree.current.refreshLoadedDirs("/p/ws"));

    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
    expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]);
  });

  it("reads both folders of a move again when a file type registers during it", async () => {
    const tree = await openTree(["/p/ws/sub"]);

    await registerWhileReading("/p/ws/sub", () =>
      tree.current.refreshAfterMove("/p/ws/old.md", "/p/ws/sub", "/p/ws/sub/old.md", "/p/ws"),
    );

    expect(names(tree, "/p/ws")).toEqual(["sub", "a.md", "sketch.excalidraw"]);
    expect(names(tree, "/p/ws/sub")).toEqual(["deep", "plan.excalidraw"]);
  });
});
