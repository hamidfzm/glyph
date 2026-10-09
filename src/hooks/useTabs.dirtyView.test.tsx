import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { deferred } from "@/test/deferred";
import {
  defaultOptions,
  fileOf,
  type Invoker,
  makeInvoker,
  resetTabsMocks,
  type TabsHook,
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

const SAVED = "- [ ] task";
const TICKED = "- [x] task";
const UNSAVED = "- [ ] task\n\nmy unsaved work";
const UNSAVED_TICKED = "- [x] task\n\nmy unsaved work";

function mockDisk(body: string, writeFile: Mock = vi.fn().mockResolvedValue(undefined)) {
  vi.mocked(invoke).mockImplementation(
    makeInvoker({
      read_file: async () => body,
      write_file: writeFile as unknown as Invoker,
    }) as typeof invoke,
  );
  return writeFile;
}

/** A write mock whose first call stays in flight until `release` is called. */
function gatedFirstWrite() {
  const gate = deferred();
  const started = deferred();
  const writeFile = vi
    .fn()
    .mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
    })
    .mockResolvedValue(undefined);
  return { writeFile, started: started.promise, release: gate.resolve };
}

function written(writeFile: Mock): string[] {
  return writeFile.mock.calls.map(([, args]) => (args as { content: string }).content);
}

/** Let work that is free to start do so, without waiting for it to finish. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openTab(result: TabsHook, path = "/p/a.md") {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  await act(async () => {
    await result.current.openFile(path);
  });
  return result.current.tabs[0].id;
}

function typeInEditMode(result: TabsHook, tabId: string, text: string) {
  act(() => {
    result.current.setTabMode(tabId, "edit");
  });
  act(() => {
    result.current.updateEditContent(tabId, text);
  });
}

/** Leave the tab dirty in view mode: typed in edit mode, switched before any save. */
function typeThenView(result: TabsHook, tabId: string, text: string) {
  typeInEditMode(result, tabId, text);
  act(() => {
    result.current.setTabMode(tabId, "view");
  });
}

describe("useTabs programmatic edits on a dirty view-mode tab", () => {
  it("toggleTask applies to the unsaved buffer instead of writing over it", async () => {
    const writeFile = mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    typeThenView(result, tabId, UNSAVED);

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    expect(fileOf(result).editContent).toBe(UNSAVED_TICKED);
    expect(fileOf(result).dirty).toBe(true);
    // Nothing reached disk around the buffer; the save path writes both edits.
    expect(writeFile).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.saveDocument(tabId);
    });
    expect(written(writeFile)).toEqual([UNSAVED_TICKED]);
    expect(fileOf(result).dirty).toBe(false);
  });

  it("toggleTask targets the line of the buffer, which is what the view renders", async () => {
    mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    typeThenView(result, tabId, "intro\n\n- [ ] task");

    await act(async () => {
      await result.current.toggleTask(tabId, 3);
    });

    expect(fileOf(result).editContent).toBe("intro\n\n- [x] task");
  });

  it("commitEdit lands in the unsaved buffer and undo restores that buffer", async () => {
    const writeFile = mockDisk("SAVED BOARD");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result, "/p/board.canvas");
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    await act(async () => {
      await result.current.commitEdit(tabId, "UNSAVED BOARD");
    });
    act(() => {
      result.current.setTabMode(tabId, "view");
    });

    await act(async () => {
      await result.current.commitEdit(tabId, "UNSAVED BOARD, TICKED");
    });
    expect(fileOf(result).editContent).toBe("UNSAVED BOARD, TICKED");
    expect(fileOf(result).dirty).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();

    // Undo steps back to the unsaved board, not to the older text on disk.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(fileOf(result).editContent).toBe("UNSAVED BOARD");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("undoEdit does not replay an older edit over text typed since", async () => {
    const writeFile = mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    expect(written(writeFile)).toEqual([TICKED]);
    typeThenView(result, tabId, UNSAVED_TICKED);

    await act(async () => {
      await result.current.undoEdit(tabId);
    });

    expect(fileOf(result).editContent).toBe(UNSAVED_TICKED);
    expect(fileOf(result).dirty).toBe(true);
    expect(written(writeFile)).toEqual([TICKED]);
  });

  it("redoEdit does not replay an older edit over text typed since", async () => {
    const writeFile = mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(written(writeFile)).toEqual([TICKED, SAVED]);
    typeThenView(result, tabId, UNSAVED);

    await act(async () => {
      await result.current.redoEdit(tabId);
    });

    expect(fileOf(result).editContent).toBe(UNSAVED);
    expect(fileOf(result).dirty).toBe(true);
    expect(written(writeFile)).toEqual([TICKED, SAVED]);
  });

  it("undoEdit is dropped in edit mode too once the user has typed over the edit", async () => {
    mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    const tabId = await openTab(result);
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    act(() => {
      result.current.updateEditContent(tabId, UNSAVED_TICKED);
    });

    await act(async () => {
      await result.current.undoEdit(tabId);
    });

    expect(fileOf(result).editContent).toBe(UNSAVED_TICKED);
  });

  it("a toggle made while a save is in flight does not start a second write", async () => {
    const { writeFile, started, release } = gatedFirstWrite();
    mockDisk(SAVED, writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    typeInEditMode(result, tabId, UNSAVED);

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await started;
    });
    act(() => {
      result.current.setTabMode(tabId, "view");
    });
    let toggling: Promise<void> | undefined;
    await act(async () => {
      toggling = result.current.toggleTask(tabId, 1);
      await tick();
    });
    // Read while the save is still held, asserted once it is released so a
    // failure here cannot strand the held write.
    const writesDuringSave = written(writeFile);

    await act(async () => {
      release();
      await saving;
      await toggling;
    });
    expect(writesDuringSave).toEqual([UNSAVED]);
    // The save landed, but the toggle is newer, so the tab stays dirty.
    expect(fileOf(result).content).toBe(UNSAVED);
    expect(fileOf(result).editContent).toBe(UNSAVED_TICKED);
    expect(fileOf(result).dirty).toBe(true);

    await act(async () => {
      await result.current.saveDocument(tabId);
    });
    expect(written(writeFile)).toEqual([UNSAVED, UNSAVED_TICKED]);
    expect(fileOf(result).dirty).toBe(false);
  });

  it("text typed while a view-mode write is in flight survives the write landing", async () => {
    const { writeFile, started, release } = gatedFirstWrite();
    mockDisk(SAVED, writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);

    let toggling: Promise<void> | undefined;
    await act(async () => {
      toggling = result.current.toggleTask(tabId, 1);
      await started;
    });
    typeInEditMode(result, tabId, UNSAVED);

    await act(async () => {
      release();
      await toggling;
    });

    expect(fileOf(result).content).toBe(TICKED);
    expect(fileOf(result).editContent).toBe(UNSAVED);
    expect(fileOf(result).dirty).toBe(true);
  });

  it("a save started while a view-mode write is in flight lands after it", async () => {
    const { writeFile, started, release } = gatedFirstWrite();
    mockDisk(SAVED, writeFile);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);

    let toggling: Promise<void> | undefined;
    await act(async () => {
      toggling = result.current.toggleTask(tabId, 1);
      await started;
    });
    typeInEditMode(result, tabId, UNSAVED);

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await tick();
    });
    const writesDuringToggle = written(writeFile);

    await act(async () => {
      release();
      await toggling;
      await saving;
    });
    // The save did not start until the write ahead of it had finished.
    expect(writesDuringToggle).toEqual([TICKED]);
    expect(written(writeFile)).toEqual([TICKED, UNSAVED]);
    expect(fileOf(result).content).toBe(UNSAVED);
    expect(fileOf(result).dirty).toBe(false);
  });

  it("closing the tab after a toggle flushes the typed text and the toggle together", async () => {
    const writeFile = mockDisk(SAVED);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await openTab(result);
    typeThenView(result, tabId, UNSAVED);
    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    await act(async () => {
      await result.current.closeTab(tabId);
    });

    expect(written(writeFile).at(-1)).toBe(UNSAVED_TICKED);
    expect(result.current.tabs).toHaveLength(0);
  });
});
