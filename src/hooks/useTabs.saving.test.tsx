import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { type Deferred, deferred } from "@/test/deferred";
import {
  defaultOptions,
  fileOf,
  type Invoker,
  makeInvoker,
  openEditable,
  resetTabsMocks,
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

describe("useTabs saving", () => {
  it("updateEditContent marks the file dirty and saveDocument writes and clears it", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
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
