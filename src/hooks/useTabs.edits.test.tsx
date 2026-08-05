import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureListener,
  defaultOptions,
  type Invoker,
  makeInvoker,
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

describe("useTabs programmatic edits", () => {
  it("toggleTask in view mode writes to disk and records an undoable edit", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/p/tasks.md",
      content: "- [x] task",
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/tasks.md",
      content: "- [ ] task",
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [ ] task");
    }

    await act(async () => {
      await result.current.redoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }
  });

  it("toggleTask in edit mode mutates editContent and is undoable", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("- [x] task");
      expect(result.current.tabs[0].file.dirty).toBe(true);
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("- [ ] task");
    }
  });

  it("commitEdit in view mode refreshes a stale editContent shadow", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: async () => undefined,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    // Editing seeds editContent; switching back to view leaves it behind.
    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "EDIT-MODE-STATE");
    });
    act(() => {
      result.current.setTabMode(tabId, "view");
    });

    await act(async () => {
      await result.current.commitEdit(tabId, "VIEW-MODE-COMMIT");
    });
    if (result.current.tabs[0].kind === "file") {
      // Both content and the leftover shadow must advance, or consumers that
      // render `editContent ?? content` (the canvas viewer) would show the
      // pre-commit board.
      expect(result.current.tabs[0].file.content).toBe("VIEW-MODE-COMMIT");
      expect(result.current.tabs[0].file.editContent).toBe("VIEW-MODE-COMMIT");
    }
  });

  it("commitEdit in view mode writes to disk and is undoable", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/board.canvas", content: "B" });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("B");
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("A");
    }
  });

  it("commitEdit in edit mode mutates editContent and ignores no-op writes", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/doc.md");
    });
    const tabId = result.current.tabs[0].id;

    // No-op: committing the unchanged content does nothing.
    await act(async () => {
      await result.current.commitEdit(tabId, "A");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.dirty).toBe(false);
    }

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("B");
      expect(result.current.tabs[0].file.dirty).toBe(true);
    }
  });

  it("commitEdit is a no-op for an unknown tab id", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.commitEdit("nope", "X");
    });
  });

  it("commitEdit is a no-op for a graph tab", async () => {
    // Graph tabs have no document, so the activeFileOf read inside commitEdit
    // comes back null and nothing is written.
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    const graphId = result.current.tabs.find((t) => t.kind === "graph")?.id as string;

    await act(async () => {
      await result.current.commitEdit(graphId, "X");
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("commitEdit diffs against the live edit buffer when one exists", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => "A" }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ defaultEditorMode: "edit" })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/doc.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.updateEditContent(tabId, "DRAFT");
    });
    // No-op: the committed content matches the edit buffer, not the disk content.
    await act(async () => {
      await result.current.commitEdit(tabId, "DRAFT");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("DRAFT");
    }

    await act(async () => {
      await result.current.commitEdit(tabId, "NEW");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("NEW");
    }

    // Undo restores the edit buffer the commit was diffed against.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("DRAFT");
    }
  });

  it("commitEdit records no undo entry when the disk write fails", async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "A",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/board.canvas");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.commitEdit(tabId, "B");
    });
    expect(writeFile).toHaveBeenCalledOnce();
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("A");
    }

    // Nothing was pushed onto the history stack, so undo has nothing to write.
    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("undoEdit is a no-op when there is no history", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "- [ ] task",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("an external file-changed reload drops the undo stack", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    let body = "- [ ] task";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => body,
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );

    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });
    writeFile.mockClear();

    // Skip past the self-save grace window (1500ms) so the file-changed event
    // is treated as a true external reload rather than the echo of our write.
    const realNow = Date.now;
    const offset = 5000;
    Date.now = () => realNow() + offset;
    try {
      body = "EXTERNAL EDIT";
      await act(async () => {
        fileChanged.handler?.({ payload: "/p/tasks.md" });
        await new Promise((r) => setTimeout(r, 350));
      });
    } finally {
      Date.now = realNow;
    }

    await act(async () => {
      await result.current.undoEdit(tabId);
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("skips an external reload while the file is dirty in edit mode", async () => {
    // Covers the guard that protects unsaved edits: a file-changed event must
    // not overwrite the in-memory editContent when the tab is dirty.
    let body = "original";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );

    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "unsaved work");
    });

    body = "EXTERNAL CHANGE";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    // The dirty edit buffer is preserved; the external change is not pulled in
    // (content stays the originally-loaded body, not the EXTERNAL CHANGE).
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.editContent).toBe("unsaved work");
      expect(result.current.tabs[0].file.content).toBe("original");
    }
  });

  it("ignores a file-changed event for an image path without reading it", async () => {
    // Images are never read as text; the auto-reload guard short-circuits on an
    // image path before any read_file, even if a stray event arrives.
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/diagram.svg");
    });
    vi.mocked(invoke).mockClear();

    await act(async () => {
      fileChanged.handler?.({ payload: "/p/diagram.svg" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/diagram.svg" });
  });
});
