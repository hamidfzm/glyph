import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileType } from "@/lib/plugins/fileTypes";
import { overlays, showOverlay } from "@/lib/plugins/overlays";
import { deferred } from "@/test/deferred";
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

const NOTE = "# Note\n\n```excalidraw\nold\n```\n";
const BLOCK = { startLine: 3, endLine: 5, code: "old" };

async function openNote(
  path: string,
  text: string,
  mode: "view" | "edit" = "view",
  writeFile = vi.fn().mockResolvedValue(undefined),
) {
  vi.mocked(invoke).mockImplementation(
    makeInvoker({
      read_file: async () => text,
      write_file: writeFile as unknown as Invoker,
    }) as typeof invoke,
  );
  const hook = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: mode })));
  await waitFor(() => expect(hook.result.current.initializing).toBe(false));
  await act(async () => {
    await hook.result.current.openFile(path);
  });
  return { ...hook, writeFile, tabId: hook.result.current.tabs[0].id };
}

function fileOf(tab: ReturnType<typeof useTabs>["tabs"][number]) {
  if (tab.kind !== "file") throw new Error("expected a file tab");
  return tab.file;
}

describe("useTabs editFencedBlock", () => {
  it("writes the block of a clean view-mode tab to disk, undoably", async () => {
    const { result, writeFile, tabId } = await openNote("/p/note.md", NOTE);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock(tabId, "/p/note.md", BLOCK, "new");
    });
    expect(saved).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/p/note.md",
      content: "# Note\n\n```excalidraw\nnew\n```\n",
    });

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(fileOf(result.current.tabs[0]).content).toBe(NOTE);
  });

  it("keeps the edit in the buffer of an edit-mode tab", async () => {
    const { result, writeFile, tabId } = await openNote("/p/note.md", NOTE, "edit");

    await act(async () => {
      await result.current.editFencedBlock(tabId, "/p/note.md", BLOCK, "new");
    });
    const file = fileOf(result.current.tabs[0]);
    expect(file.editContent).toBe("# Note\n\n```excalidraw\nnew\n```\n");
    expect(file.dirty).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refuses a block the text no longer holds and writes nothing", async () => {
    const { result, writeFile, tabId } = await openNote("/p/note.md", NOTE);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock(
        tabId,
        "/p/note.md",
        { ...BLOCK, code: "stale" },
        "new",
      );
    });
    expect(saved).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(fileOf(result.current.tabs[0]).content).toBe(NOTE);
  });

  it("succeeds without a write when the code is unchanged", async () => {
    const { result, writeFile, tabId } = await openNote("/p/note.md", NOTE);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock(tabId, "/p/note.md", BLOCK, "old");
    });
    expect(saved).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("replaces the whole text of a source document", async () => {
    const dispose = registerFileType({ extensions: ["excalidraw"], language: "excalidraw" });
    try {
      const { result, writeFile, tabId } = await openNote("/p/sketch.excalidraw", '{"a":1}\n');

      let saved: boolean | undefined;
      await act(async () => {
        saved = await result.current.editFencedBlock(
          tabId,
          "/p/sketch.excalidraw",
          { startLine: 1, endLine: 3, code: '{"a":1}' },
          '{"a":2}',
        );
      });
      expect(saved).toBe(true);
      expect(writeFile).toHaveBeenCalledWith("write_file", {
        path: "/p/sketch.excalidraw",
        content: '{"a":2}\n',
      });
    } finally {
      dispose();
    }
  });

  it("resolves false for a tab with no text", async () => {
    const { result, writeFile, tabId } = await openNote("/p/picture.png", "");

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock(tabId, "/p/picture.png", BLOCK, "new");
    });
    expect(saved).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refuses a block of a file the tab no longer shows", async () => {
    const { result, writeFile, tabId } = await openNote("/p/note.md", NOTE);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock(tabId, "/p/other.md", BLOCK, "new");
    });
    expect(saved).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("a close saves what an open plugin overlay holds before it checks the tabs", async () => {
    const gate = deferred();
    const writeFile = vi.fn(() => gate.promise);
    const { result, tabId } = await openNote("/p/note.md", NOTE, "view", writeFile);
    // Stands in for a drawing editor whose cleanup saves its block.
    const remove = showOverlay({
      id: "editor",
      label: "Editor",
      mount: () => {},
      close: () => {
        void result.current.editFencedBlock(tabId, "/p/note.md", BLOCK, "new");
        remove();
      },
    });

    let closed: boolean | undefined;
    let flush: Promise<boolean> = Promise.resolve(false);
    act(() => {
      flush = result.current.flushForClose().then((ok) => {
        closed = ok;
        return ok;
      });
    });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    expect(overlays.list()).toHaveLength(0);
    expect(closed).toBeUndefined();

    gate.resolve();
    await act(async () => {
      await flush;
    });
    expect(closed).toBe(true);
  });

  it("resolves false for an unknown tab", async () => {
    const { result } = await openNote("/p/note.md", NOTE);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editFencedBlock("nope", "/p/note.md", BLOCK, "new");
    });
    expect(saved).toBe(false);
  });
});
