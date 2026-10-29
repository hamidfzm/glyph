import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import {
  defaultOptions,
  holdWrites,
  mockWriteFile,
  resetTabsMocks,
  writesOf,
} from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSaveDocument: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

beforeEach(resetTabsMocks);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTabs close coordinator", () => {
  type Hook = { current: ReturnType<typeof useTabs> };

  async function ready(result: Hook) {
    await waitFor(() => expect(result.current.initializing).toBe(false));
  }

  // Open `path` as a loose tab in edit mode with a dirty buffer, returning its id.
  async function openDirty(result: Hook, path: string, content = "EDITED") {
    await act(async () => {
      await result.current.openFile(path);
    });
    const id = result.current.tabs.find((t) => t.kind === "file" && t.file.path === path)?.id;
    if (!id) throw new Error(`no tab for ${path}`);
    act(() => {
      result.current.setTabMode(id, "edit");
    });
    act(() => {
      result.current.updateEditContent(id, content);
    });
    return id;
  }

  function hasTab(result: Hook, id: string) {
    return result.current.tabs.some((t) => t.id === id);
  }

  function isDirty(result: Hook, id: string) {
    const tab = result.current.tabs.find((t) => t.id === id);
    return tab?.kind === "file" && tab.file.dirty;
  }

  // Closing a tab by mouse click or Cmd/Ctrl+W both route through closeTab.
  it("closeTab flushes a dirty tab, then removes it", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "BODY");

    await act(async () => {
      await result.current.closeTab(id);
    });

    expect(writesOf(writeFile)).toEqual([{ path: "/p/a.md", content: "BODY" }]);
    expect(hasTab(result, id)).toBe(false);
  });

  it("closeTab keeps the tab open when a failed save's discard is cancelled", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md");

    await act(async () => {
      await result.current.closeTab(id);
    });

    expect(ask).toHaveBeenCalled();
    expect(hasTab(result, id)).toBe(true);
    expect(isDirty(result, id)).toBe(true);
    errSpy.mockRestore();
  });

  it("closeTab discards and closes after the user confirms a failed save", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(true);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md");

    await act(async () => {
      await result.current.closeTab(id);
    });

    expect(hasTab(result, id)).toBe(false);
    errSpy.mockRestore();
  });

  it("closeWorkspace flushes every dirty tab in the workspace", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws");
    });
    const id = await openDirty(result, "/ws/a.md", "WS");

    await act(async () => {
      await result.current.closeWorkspace();
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/ws/a.md", content: "WS" });
    expect(result.current.workspace).toBeNull();
    expect(hasTab(result, id)).toBe(false);
  });

  it("cancelling the discard keeps the workspace open", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws");
    });
    const id = await openDirty(result, "/ws/a.md");

    await act(async () => {
      await result.current.closeWorkspace();
    });

    // A cancelled discard leaves the workspace and its dirty tab intact.
    expect(result.current.workspace?.root).toBe("/ws");
    expect(hasTab(result, id)).toBe(true);
    errSpy.mockRestore();
  });

  it("replacing the workspace flushes the outgoing workspace's dirty tabs", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws1");
    });
    await openDirty(result, "/ws1/a.md", "R");

    await act(async () => {
      await result.current.openFolder("/ws2");
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/ws1/a.md", content: "R" });
    expect(result.current.workspace?.root).toBe("/ws2");
  });

  it("cancelling the discard aborts a workspace replacement", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws1");
    });
    await openDirty(result, "/ws1/a.md");

    await act(async () => {
      await result.current.openFolder("/ws2");
    });

    // The switch was aborted: the original workspace is still open.
    expect(result.current.workspace?.root).toBe("/ws1");
    errSpy.mockRestore();
  });

  it("flushForClose saves every dirty tab (multi-tab shutdown) and reports success", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const a = await openDirty(result, "/p/a.md", "A");
    const b = await openDirty(result, "/p/b.md", "B");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "A" });
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/b.md", content: "B" });
    expect(isDirty(result, a)).toBe(false);
    expect(isDirty(result, b)).toBe(false);
  });

  it("flushForClose returns false when the user cancels after a failed save", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await openDirty(result, "/p/a.md");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(false);
    errSpy.mockRestore();
  });

  it("flushForClose returns true when the user confirms discarding a failed save", async () => {
    expectConsole(/Auto-save failed/);
    // The shared ask mock accumulates calls across this file; count only ours.
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValue(true);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await openDirty(result, "/p/a.md");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    // Shutdown proceeds only through an explicit informed discard (INV-1):
    // the confirmation dialog must actually have been shown.
    expect(ok).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  // A batch close is all-or-nothing: cancelling the prompt for one dirty tab
  // must not leave the clean tabs of the same batch already closed.
  it("closeTabs keeps every tab of the batch open when the discard is cancelled", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const dirtyId = await openDirty(result, "/p/a.md");
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    const cleanId = result.current.tabs.find((t) => t.id !== dirtyId)?.id as string;

    await act(async () => {
      await result.current.closeTabs([dirtyId, cleanId]);
    });

    expect(hasTab(result, dirtyId)).toBe(true);
    expect(hasTab(result, cleanId)).toBe(true);
    errSpy.mockRestore();
  });

  it("does not prompt with autosave on: the close flush stays silent", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const confirmUnsaved = vi.fn(async () => "cancel" as const);
    const { result } = renderHook(() => useTabs(defaultOptions({ confirmUnsaved })));
    await ready(result);
    await openDirty(result, "/p/a.md", "A");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(true);
    expect(confirmUnsaved).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "A" });
  });

  it("prompts with every dirty document when autosave is off", async () => {
    mockWriteFile(vi.fn().mockResolvedValue(undefined));
    const confirmUnsaved = vi.fn(async () => "save" as const);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved })),
    );
    await ready(result);
    await openDirty(result, "/p/a.md", "A");
    await openDirty(result, "/p/b.md", "B");

    await act(async () => {
      await result.current.flushForClose();
    });

    expect(confirmUnsaved).toHaveBeenCalledWith(["/p/a.md", "/p/b.md"]);
  });

  it("saves and proceeds when the user picks Save", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "save" as const })),
    );
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "A");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "A" });
    expect(isDirty(result, id)).toBe(false);
  });

  it("proceeds without writing when the user picks Don't Save", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "discard" as const })),
    );
    await ready(result);
    await openDirty(result, "/p/a.md", "A");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("aborts the close and keeps the tab dirty when the user cancels", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "cancel" as const })),
    );
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "A");

    // Through closeTab, so the abort is observed the way the user sees it.
    await act(async () => {
      await result.current.closeTab(id);
    });

    expect(hasTab(result, id)).toBe(true);
    expect(isDirty(result, id)).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // A batch close prompts once, for the dirty members only, and stays
  // all-or-nothing: cancelling keeps the clean tabs of the batch open too.
  it("closeTabs prompts for the dirty members and keeps the batch open on cancel", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const confirmUnsaved = vi.fn(async () => "cancel" as const);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved })),
    );
    await ready(result);
    const dirtyId = await openDirty(result, "/p/a.md", "A");
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    const cleanId = result.current.tabs.find((t) => t.id !== dirtyId)?.id as string;

    await act(async () => {
      await result.current.closeTabs([dirtyId, cleanId]);
    });

    expect(confirmUnsaved).toHaveBeenCalledWith(["/p/a.md"]);
    expect(hasTab(result, dirtyId)).toBe(true);
    expect(hasTab(result, cleanId)).toBe(true);
    expect(isDirty(result, dirtyId)).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("closeTabs reports whether the tabs actually closed", async () => {
    // "Open in new window" moves a note by closing its tab first, so it needs
    // to know a cancelled prompt left the tab in place.
    const confirmUnsaved = vi.fn(async () => "cancel" as const);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved })),
    );
    await ready(result);
    const dirtyId = await openDirty(result, "/p/a.md", "A");

    let cancelled: boolean | undefined;
    await act(async () => {
      cancelled = await result.current.closeTabs([dirtyId]);
    });
    expect(cancelled).toBe(false);
    expect(hasTab(result, dirtyId)).toBe(true);

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeTabs([]);
    });
    // An empty batch is trivially "closed": nothing blocked it.
    expect(closed).toBe(true);

    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    const cleanId = result.current.tabs.find((t) => t.id !== dirtyId)?.id as string;
    let closedClean: boolean | undefined;
    await act(async () => {
      closedClean = await result.current.closeTabs([cleanId]);
    });
    expect(closedClean).toBe(true);
    expect(hasTab(result, cleanId)).toBe(false);
  });

  it("closeTabs discards the whole batch when the user picks Don't Save", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "discard" as const })),
    );
    await ready(result);
    const dirtyId = await openDirty(result, "/p/a.md", "A");
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    const cleanId = result.current.tabs.find((t) => t.id !== dirtyId)?.id as string;

    await act(async () => {
      await result.current.closeTabs([dirtyId, cleanId]);
    });

    expect(hasTab(result, dirtyId)).toBe(false);
    expect(hasTab(result, cleanId)).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("flushes edits made while the prompt was open, not just the snapshot", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    // The prompt is open for user time, during which the menu, plugins, or an
    // external reload can dirty another document. The gate holds it open.
    const answer = deferred<"save">();
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: () => answer.promise })),
    );
    await ready(result);
    await openDirty(result, "/p/a.md", "A");
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    const bId = result.current.tabs.find((t) => t.kind === "file" && t.file.path === "/p/b.md")?.id;
    if (!bId) throw new Error("no tab for /p/b.md");
    act(() => {
      result.current.setTabMode(bId, "edit");
    });

    let flush: Promise<boolean> | undefined;
    await act(async () => {
      flush = result.current.flushForClose();
    });
    // The prompt is up: B goes dirty only now, after the snapshot was taken.
    act(() => {
      result.current.updateEditContent(bId, "B LATE");
    });
    await act(async () => {
      answer.resolve("save");
      await flush;
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/b.md", content: "B LATE" });
    expect(isDirty(result, bId)).toBe(false);
  });

  it("aborts a workspace switch when the user cancels the prompt", async () => {
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "cancel" as const })),
    );
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws1");
    });
    await openDirty(result, "/ws1/a.md");

    await act(async () => {
      await result.current.openFolder("/ws2");
    });

    expect(result.current.workspace?.root).toBe("/ws1");
  });

  it("still confirms a discard when a save chosen at the prompt fails", async () => {
    expectConsole(/Auto-save failed/);
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValue(false);
    mockWriteFile(vi.fn().mockRejectedValue(new Error("disk full")));
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "save" as const })),
    );
    await ready(result);
    await openDirty(result, "/p/a.md", "A");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    // The failed write falls through to the existing discard/cancel dialog
    // rather than dropping the edits silently.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ok).toBe(false);
  });

  type Close = (r: Hook, id: string) => Promise<unknown>;
  // Whether the close went through, given what it resolved with.
  type Closed = (r: Hook, id: string, resolved: unknown) => boolean;

  // The tab stays on screen while its write is in flight, so typing still reaches it.
  it.each<[string, Partial<Parameters<typeof useTabs>[0]>, Close, Closed]>([
    ["a tab close", {}, (r, id) => r.current.closeTab(id), (r, id) => !hasTab(r, id)],
    [
      "a workspace close",
      {},
      (r) => r.current.closeWorkspace(),
      (r) => r.current.workspace === null,
    ],
    [
      "a workspace switch",
      {},
      (r) => r.current.openFolder("/ws2"),
      (r) => r.current.workspace?.root === "/ws2",
    ],
    [
      "a window close",
      {},
      (r) => r.current.flushForClose(),
      (_r, _id, resolved) => resolved === true,
    ],
    [
      "a window close after Save at the prompt",
      { autoSave: false, confirmUnsaved: async () => "save" as const },
      (r) => r.current.flushForClose(),
      (_r, _id, resolved) => resolved === true,
    ],
  ])(
    "%s writes an edit made while its save was in flight",
    async (_how, options, close, closed) => {
      const { writeFile, started, release } = holdWrites(1);
      const { result } = renderHook(() => useTabs(defaultOptions(options)));
      await ready(result);
      await act(async () => {
        await result.current.openFolder("/ws");
      });
      const id = await openDirty(result, "/ws/a.md", "one");

      let closing: Promise<unknown> | undefined;
      await act(async () => {
        closing = close(result, id);
        await started[0].promise;
      });
      act(() => {
        result.current.updateEditContent(id, "one two");
      });
      let resolved: unknown;
      await act(async () => {
        release[0].resolve();
        resolved = await closing;
      });

      expect(writesOf(writeFile)).toEqual([
        { path: "/ws/a.md", content: "one" },
        { path: "/ws/a.md", content: "one two" },
      ]);
      expect(isDirty(result, id)).toBe(false);
      expect(closed(result, id, resolved)).toBe(true);
    },
  );

  it.each<[string, Close]>([
    ["a workspace close", (r) => r.current.closeWorkspace()],
    ["a workspace switch", (r) => r.current.openFolder("/ws2")],
  ])("%s saves a workspace tab opened and edited during its flush", async (_how, close) => {
    const { writeFile, started, release } = holdWrites(1);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws");
    });
    const a = await openDirty(result, "/ws/a.md", "A");

    let closing: Promise<unknown> | undefined;
    await act(async () => {
      closing = close(result, a);
      await started[0].promise;
    });
    const c = await openDirty(result, "/ws/c.md", "C");
    await act(async () => {
      release[0].resolve();
      await closing;
    });

    expect(writesOf(writeFile)).toEqual([
      { path: "/ws/a.md", content: "A" },
      { path: "/ws/c.md", content: "C" },
    ]);
    expect(hasTab(result, c)).toBe(false);
  });

  it("closeTab removes the tab only once its late edit is on disk", async () => {
    const { writeFile, started, release } = holdWrites(1);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const other = await openDirty(result, "/p/b.md", "B");
    const id = await openDirty(result, "/p/a.md", "one");

    let closing: Promise<boolean> | undefined;
    await act(async () => {
      closing = result.current.closeTab(id);
      await started[0].promise;
    });
    act(() => {
      result.current.updateEditContent(id, "one two");
      result.current.updateEditContent(other, "B more");
    });
    let closed: boolean | undefined;
    await act(async () => {
      release[0].resolve();
      closed = await closing;
    });

    expect(closed).toBe(true);
    // A tab outside the close is neither written nor waited on.
    expect(writesOf(writeFile)).toEqual([
      { path: "/p/a.md", content: "one" },
      { path: "/p/a.md", content: "one two" },
    ]);
    expect(hasTab(result, id)).toBe(false);
    expect(isDirty(result, other)).toBe(true);
  });

  it("flushForClose keeps saving while edits keep arriving during slow writes", async () => {
    const { writeFile, started, release } = holdWrites(2);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "one");

    let flush: Promise<boolean> | undefined;
    await act(async () => {
      flush = result.current.flushForClose();
      await started[0].promise;
    });
    act(() => {
      result.current.updateEditContent(id, "one two");
    });
    act(() => {
      result.current.updateEditContent(id, "one two three");
    });
    await act(async () => {
      release[0].resolve();
      await started[1].promise;
    });
    act(() => {
      result.current.updateEditContent(id, "one two three four");
    });
    let ok: boolean | undefined;
    await act(async () => {
      release[1].resolve();
      ok = await flush;
    });

    expect(ok).toBe(true);
    expect(writesOf(writeFile).map((write) => write.content)).toEqual([
      "one",
      "one two three",
      "one two three four",
    ]);
    expect(isDirty(result, id)).toBe(false);
  });

  it.each<[string, Close]>([
    ["a tab close", (r, id) => r.current.closeTab(id)],
    ["a workspace close", (r) => r.current.closeWorkspace()],
    ["a window close", (r) => r.current.flushForClose()],
  ])("%s writes an edit made in the same tick as the close", async (_how, close) => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws");
    });
    await act(async () => {
      await result.current.openFile("/ws/a.md");
    });
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.setTabMode(id, "edit");
    });

    let closing: Promise<unknown> | undefined;
    act(() => {
      result.current.updateEditContent(id, "typed");
      closing = close(result, id);
    });
    await act(async () => {
      await closing;
    });

    expect(writesOf(writeFile)).toEqual([{ path: "/ws/a.md", content: "typed" }]);
    expect(isDirty(result, id)).toBe(false);
  });

  it("lists a tab whose catch-up write fails in the discard prompt", async () => {
    expectConsole(/Auto-save failed/);
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValue(false);
    const started = deferred();
    const release = deferred();
    const writeFile = vi
      .fn()
      .mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
      })
      .mockRejectedValueOnce(new Error("disk full"));
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "one");

    let closing: Promise<boolean> | undefined;
    await act(async () => {
      closing = result.current.closeTab(id);
      await started.promise;
    });
    act(() => {
      result.current.updateEditContent(id, "one two");
    });
    let closed: boolean | undefined;
    await act(async () => {
      release.resolve();
      closed = await closing;
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ask).mock.calls[0][0]).toContain("a.md");
    expect(closed).toBe(false);
    expect(hasTab(result, id)).toBe(true);
    expect(isDirty(result, id)).toBe(true);
  });

  it("catches up the other tabs before prompting for one whose write failed", async () => {
    expectConsole(/Auto-save failed/);
    vi.mocked(ask).mockClear();
    vi.mocked(ask).mockResolvedValue(false);
    const started = deferred();
    const release = deferred();
    let writesOfB = 0;
    const writeFile = vi.fn(async (_cmd: string, args: { path: string }) => {
      if (args.path === "/p/a.md") throw new Error("disk full");
      if (writesOfB++ > 0) return;
      started.resolve();
      await release.promise;
    });
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await openDirty(result, "/p/a.md", "A");
    const b = await openDirty(result, "/p/b.md", "B");

    let flush: Promise<boolean> | undefined;
    await act(async () => {
      flush = result.current.flushForClose();
      await started.promise;
    });
    act(() => {
      result.current.updateEditContent(b, "B late");
    });
    await act(async () => {
      release.resolve();
      await flush;
    });

    const writesToB = writesOf(writeFile).filter((write) => write.path === "/p/b.md");
    expect(writesToB.map((write) => write.content)).toEqual(["B", "B late"]);
    expect(isDirty(result, b)).toBe(false);
    const message = vi.mocked(ask).mock.calls[0][0];
    expect(message).toContain("a.md");
    expect(message).not.toContain("b.md");
  });
});
