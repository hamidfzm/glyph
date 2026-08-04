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

  function writeInvoker(writeFile: ReturnType<typeof vi.fn>) {
    return makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke;
  }

  // Closing a tab by mouse click or Cmd/Ctrl+W both route through closeTab.
  it("closeTab flushes a dirty tab, then removes it", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(writeInvoker(writeFile));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const id = await openDirty(result, "/p/a.md", "BODY");

    await act(async () => {
      await result.current.closeTab(id);
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "BODY" });
    expect(hasTab(result, id)).toBe(false);
  });

  it("closeTab keeps the tab open when a failed save's discard is cancelled", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
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
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
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
    vi.mocked(invoke).mockImplementation(writeInvoker(writeFile));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws", { autoLoad: false });
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
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws", { autoLoad: false });
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
    vi.mocked(invoke).mockImplementation(writeInvoker(writeFile));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws1", { autoLoad: false });
    });
    await openDirty(result, "/ws1/a.md", "R");

    await act(async () => {
      await result.current.openFolder("/ws2", { autoLoad: false });
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/ws1/a.md", content: "R" });
    expect(result.current.workspace?.root).toBe("/ws2");
  });

  it("cancelling the discard aborts a workspace replacement", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    await act(async () => {
      await result.current.openFolder("/ws1", { autoLoad: false });
    });
    await openDirty(result, "/ws1/a.md");

    await act(async () => {
      await result.current.openFolder("/ws2", { autoLoad: false });
    });

    // The switch was aborted: the original workspace is still open.
    expect(result.current.workspace?.root).toBe("/ws1");
    errSpy.mockRestore();
  });

  it("flushForClose saves every dirty tab (multi-tab shutdown) and reports success", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(writeInvoker(writeFile));
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await ready(result);
    const a = await openDirty(result, "/p/a.md", "A");
    const b = await openDirty(result, "/p/b.md", "B");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flushForClose();
    });

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "A" });
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/b.md", content: "B" });
    expect(isDirty(result, a)).toBe(false);
    expect(isDirty(result, b)).toBe(false);
  });

  it("flushForClose returns false when the user cancels after a failed save", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
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
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
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
    vi.mocked(invoke).mockImplementation(
      writeInvoker(vi.fn().mockRejectedValue(new Error("disk full"))),
    );
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
});
