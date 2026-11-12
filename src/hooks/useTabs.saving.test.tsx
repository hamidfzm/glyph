import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { type Deferred, deferred } from "@/test/deferred";
import {
  applied,
  defaultOptions,
  deliver,
  fileOf,
  holdWrites,
  mockWriteFile,
  openEditable,
  openWorkspaceNote,
  renamesTo,
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

describe("useTabs saving", () => {
  it("updateEditContent marks the file dirty and saveDocument writes and clears it", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "EDITED");
    });
    expect(fileOf(result).dirty).toBe(true);
    expect(fileOf(result).editContent).toBe("EDITED");

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "EDITED" });
    expect(fileOf(result).dirty).toBe(false);
    expect(fileOf(result).content).toBe("EDITED");
  });

  it("saveDocument is a no-op for a clean tab", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    // openEditable enters edit mode but makes no edit, so the tab stays clean.
    const tabId = await openEditable(result);
    expect(fileOf(result).dirty).toBe(false);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("saveDocument is a no-op for an unknown or non-file tab id", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument("does-not-exist");
    });

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps the tab dirty when a newer edit lands during an in-flight write", async () => {
    const writeGate = deferred();
    const writeStarted = deferred();
    const writeFile = vi.fn().mockImplementation(async () => {
      writeStarted.resolve();
      await writeGate.promise;
    });
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "V1");
    });

    let savePromise: Promise<boolean> | undefined;
    await act(async () => {
      savePromise = result.current.saveDocument(tabId);
      await writeStarted.promise;
    });

    // A newer edit arrives while the V1 write is still in flight.
    act(() => {
      result.current.updateEditContent(tabId, "V2");
    });

    await act(async () => {
      writeGate.resolve();
      await savePromise;
    });

    // The V1 write landed on disk, but the tab stays dirty because V2 is newer.
    expect(fileOf(result).content).toBe("V1");
    expect(fileOf(result).editContent).toBe("V2");
    expect(fileOf(result).dirty).toBe(true);
  });

  it("renames a note only once its write in flight has finished", async () => {
    const { writeFile, started, release } = holdWrites(1, {
      rename_path: renamesTo("/p/ws/b.md"),
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openWorkspaceNote(result);
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "EDITED");
    });

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await started[0].promise;
    });
    let renaming: Promise<string | null> | undefined;
    await deliver(() => {
      renaming = result.current.renamePath("/p/ws/a.md", "b");
    });

    // Renamed now, the write could open a.md after it moved and create it again.
    expect(applied("rename_path")).toBe(false);

    await act(async () => {
      release[0].resolve();
      await Promise.all([saving, renaming]);
    });

    expect(applied("rename_path")).toBe(true);
    expect(writesOf(writeFile)).toEqual([{ path: "/p/ws/a.md", content: "EDITED" }]);
    expect(fileOf(result).path).toBe("/p/ws/b.md");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("writes only the new path for a save asked before the tab followed the rename", async () => {
    const listing = deferred();
    const writeFile = vi.fn(async () => {});
    mockWriteFile(writeFile, {
      rename_path: renamesTo("/p/ws/b.md"),
      // The rename's own listing of the folder, held so the tab stays at a.md for now.
      read_directory: async () => {
        if (applied("rename_path")) await listing.promise;
        return [];
      },
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openWorkspaceNote(result);
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "EDITED");
    });

    let renaming: Promise<string | null> | undefined;
    await deliver(() => {
      renaming = result.current.renamePath("/p/ws/a.md", "b");
    });
    expect(applied("rename_path")).toBe(true);
    let saving: Promise<boolean> | undefined;
    await deliver(() => {
      saving = result.current.saveDocument(tabId);
    });
    await act(async () => {
      listing.resolve();
      await Promise.all([renaming, saving]);
    });

    // a.md was gone: writing it would leave a clean tab over a b.md without the edit.
    expect(writesOf(writeFile)).toEqual([]);
    expect(fileOf(result).path).toBe("/p/ws/b.md");
    expect(fileOf(result).dirty).toBe(true);

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writesOf(writeFile)).toEqual([{ path: "/p/ws/b.md", content: "EDITED" }]);
    expect(fileOf(result).dirty).toBe(false);
  });

  it("does not write the old path for a save asked while the rename waits on a write", async () => {
    const { writeFile, started, release } = holdWrites(1, {
      rename_path: renamesTo("/p/ws/b.md"),
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openWorkspaceNote(result);
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "ONE");
    });

    let first: Promise<boolean> | undefined;
    await act(async () => {
      first = result.current.saveDocument(tabId);
      await started[0].promise;
    });
    let renaming: Promise<string | null> | undefined;
    await deliver(() => {
      renaming = result.current.renamePath("/p/ws/a.md", "b");
    });
    act(() => {
      result.current.updateEditContent(tabId, "ONE TWO");
    });
    let second: Promise<boolean> | undefined;
    act(() => {
      second = result.current.saveDocument(tabId);
    });
    let saved: boolean[] = [];
    await act(async () => {
      release[0].resolve();
      saved = await Promise.all([first, second] as Promise<boolean>[]);
      await renaming;
    });

    // The second save runs after the rename, and writing a.md would bring it back beside b.md.
    expect(saved).toEqual([true, true]);
    expect(writesOf(writeFile)).toEqual([{ path: "/p/ws/a.md", content: "ONE" }]);
    expect(fileOf(result).path).toBe("/p/ws/b.md");
    expect(fileOf(result).dirty).toBe(true);

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writesOf(writeFile)).toEqual([
      { path: "/p/ws/a.md", content: "ONE" },
      { path: "/p/ws/b.md", content: "ONE TWO" },
    ]);
    expect(fileOf(result).dirty).toBe(false);
  });

  it("a close during a rename saves the tab at its new path, not the one its queued save captured", async () => {
    const { writeFile, started, release } = holdWrites(1, {
      rename_path: renamesTo("/p/ws/b.md"),
    });
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openWorkspaceNote(result);
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "ONE");
    });

    let first: Promise<boolean> | undefined;
    await act(async () => {
      first = result.current.saveDocument(tabId);
      await started[0].promise;
    });
    let renaming: Promise<string | null> | undefined;
    await deliver(() => {
      renaming = result.current.renamePath("/p/ws/a.md", "b");
    });
    act(() => {
      result.current.updateEditContent(tabId, "ONE TWO");
    });
    let closing: Promise<unknown> | undefined;
    act(() => {
      closing = result.current.closeTab(tabId);
    });
    await act(async () => {
      release[0].resolve();
      await Promise.all([first, renaming, closing]);
    });

    expect(writesOf(writeFile)).toEqual([
      { path: "/p/ws/a.md", content: "ONE" },
      { path: "/p/ws/b.md", content: "ONE TWO" },
    ]);
    expect(result.current.tabs).toHaveLength(0);
  });

  it("serializes writes for the same path so they can't complete out of order", async () => {
    const order: string[] = [];
    const gates: Deferred[] = [];
    const writeFile = vi.fn().mockImplementation(async (_cmd, args) => {
      const content = (args as { content: string }).content;
      order.push(`start:${content}`);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      order.push(`end:${content}`);
    });
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "V1");
    });
    let p1: Promise<boolean> | undefined;
    act(() => {
      p1 = result.current.saveDocument(tabId);
    });
    await waitFor(() => expect(gates).toHaveLength(1));

    // Queue a second save for the same path while the first write is gated open.
    act(() => {
      result.current.updateEditContent(tabId, "V2");
    });
    let p2: Promise<boolean> | undefined;
    act(() => {
      p2 = result.current.saveDocument(tabId);
    });
    // The second write must not start until the first has finished.
    expect(order).toEqual(["start:V1"]);

    await act(async () => {
      gates[0].resolve();
    });
    await waitFor(() => expect(gates).toHaveLength(2));
    expect(order).toEqual(["start:V1", "end:V1", "start:V2"]);

    await act(async () => {
      gates[1].resolve();
      await Promise.all([p1, p2]);
    });
    expect(order).toEqual(["start:V1", "end:V1", "start:V2", "end:V2"]);
    expect(fileOf(result).content).toBe("V2");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("writes to different paths run concurrently (per-path chains are independent)", async () => {
    const started: string[] = [];
    const gates = new Map<string, Deferred>();
    const writeFile = vi.fn().mockImplementation(async (_cmd, args) => {
      const path = (args as { path: string }).path;
      started.push(path);
      const gate = deferred();
      gates.set(path, gate);
      await gate.promise;
    });
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    const ids: string[] = [];
    for (const path of ["/p/a.md", "/p/b.md"]) {
      await act(async () => {
        await result.current.openFile(path);
      });
      const id = result.current.tabs.find((t) => t.kind === "file" && t.file.path === path)?.id;
      if (!id) throw new Error(`no tab for ${path}`);
      ids.push(id);
      act(() => {
        result.current.setTabMode(id, "edit");
      });
      act(() => {
        result.current.updateEditContent(id, `EDIT ${path}`);
      });
    }

    let saves: Array<Promise<boolean>> = [];
    act(() => {
      saves = ids.map((id) => result.current.saveDocument(id));
    });
    // Both writes are in flight at once: neither waited for the other's chain.
    await waitFor(() => expect(started).toEqual(["/p/a.md", "/p/b.md"]));

    await act(async () => {
      for (const gate of gates.values()) gate.resolve();
      await Promise.all(saves);
    });
    for (const id of ids) {
      const tab = result.current.tabs.find((t) => t.id === id);
      expect(tab?.kind === "file" && tab.file.dirty).toBe(false);
    }
  });

  it("saves a fully-deleted document: empty string is valid content (#432)", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "");
    });
    expect(fileOf(result).dirty).toBe(true);

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/a.md", content: "" });
    expect(fileOf(result).content).toBe("");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("a failed save leaves the document dirty and a later save succeeds", async () => {
    expectConsole(/Auto-save failed/);
    const writeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "V1");
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });
    expect(ok).toBe(false);
    expect(fileOf(result).dirty).toBe(true);

    // The next edit reschedules; that save succeeds and settles the document.
    act(() => {
      result.current.updateEditContent(tabId, "V2");
    });
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });
    expect(ok).toBe(true);
    expect(fileOf(result).content).toBe("V2");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("keeps the tab dirty and surfaces a notice when the write fails", async () => {
    const onWorkspaceNotice = vi.fn();
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWriteFile(writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const tabId = await openEditable(result);

    act(() => {
      result.current.updateEditContent(tabId, "X");
    });
    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(fileOf(result).dirty).toBe(true);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.saveFailed", values: { name: "a.md" } },
      { persistent: true },
    );
    errSpy.mockRestore();
  });
});
