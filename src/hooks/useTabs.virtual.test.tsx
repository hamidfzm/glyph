import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickSaveDocument } from "@/lib/pickers";
import { EDITOR_MODE } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import {
  defaultOptions,
  deliver,
  fileOf,
  holdWrites,
  type Invoker,
  makeInvoker,
  mockWriteFile,
  resetTabsMocks,
  spelledAs,
  type TabsHook,
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

/** Open an untitled buffer holding `text` and return its tab id. */
async function newDraft(result: TabsHook, text: string) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  act(() => {
    result.current.newDocument();
  });
  const tabId = result.current.activeTabId;
  if (!tabId) throw new Error("expected the new document to be active");
  act(() => {
    result.current.updateEditContent(tabId, text);
  });
  return tabId;
}

/** Open the workspace /p/ws, then an untitled buffer holding `text`; return its tab id. */
async function newDraftInWorkspace(result: TabsHook, text: string) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  await act(async () => {
    await result.current.openFolder("/p/ws");
  });
  act(() => {
    result.current.newDocument();
  });
  const tabId = result.current.tabs.find((t) => t.kind === "file" && t.file.virtual)?.id;
  if (!tabId) throw new Error("expected a virtual tab");
  act(() => {
    result.current.updateEditContent(tabId, text);
  });
  return tabId;
}

describe("useTabs in-memory documents", () => {
  it("newDocument opens a virtual editable buffer", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.newDocument();
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.kind).toBe("file");
    if (tab.kind === "file") {
      expect(tab.file.virtual).toBe(true);
      expect(tab.file.mode).toBe("edit");
      expect(tab.file.content).toBe("");
      expect(tab.file.path).toMatch(/^Untitled-\d+$/);
    }
    expect(result.current.activeTabId).toBe(tab.id);
  });

  it("saveDocument on a virtual tab writes via Save As and adopts the path", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/saved.md");
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    const tabId = await newDraft(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/saved.md", content: "HELLO" });
    const tab = result.current.tabs[0];
    if (tab.kind === "file") {
      expect(tab.file.virtual).toBe(false);
      expect(tab.file.path).toBe("/p/saved.md");
      expect(tab.file.dirty).toBe(false);
      expect(tab.file.content).toBe("HELLO");
    }
    expect(onSettingsChange).toHaveBeenCalledWith("behavior.recentFiles", ["/p/saved.md"]);
  });

  it("saveDocument keeps the buffer virtual when Save As is cancelled", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    vi.mocked(pickSaveDocument).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "X");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    const tab = result.current.tabs[0];
    if (tab.kind === "file") expect(tab.file.virtual).toBe(true);
  });

  it("saveDocument surfaces a notice and stays virtual when the write fails", async () => {
    const onWorkspaceNotice = vi.fn();
    expectConsole(/Failed to save document/);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        write_file: async () => {
          throw new Error("disk full");
        },
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const tabId = await newDraft(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(false);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveFailed" }),
      { persistent: true },
    );
    const tab = result.current.tabs[0];
    if (tab.kind === "file") expect(tab.file.virtual).toBe(true);
  });

  it("saveDocument refuses a Save As onto a path another tab already holds", async () => {
    // Two tabs on one path is a state nothing else can produce: openFile
    // activates the existing tab instead of opening a second one. Refusing
    // before the write keeps the open tab's unsaved edits out of harm's way
    // (#721).
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => "ON DISK",
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/a.md");
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ onWorkspaceNotice, autoSave: false })),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    // Tab 1 holds /p/a.md with unsaved edits of its own.
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const openId = result.current.tabs[0].id;
    act(() => {
      result.current.setTabMode(openId, EDITOR_MODE.edit);
      result.current.updateEditContent(openId, "THEIR UNSAVED WORK");
    });

    // Tab 2 is an untitled buffer saved onto that same path.
    act(() => {
      result.current.newDocument();
    });
    const virtualId = result.current.tabs[1].id;
    act(() => {
      result.current.updateEditContent(virtualId, "MY DRAFT");
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(virtualId);
    });

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveTargetOpen", values: { name: "a.md" } }),
      { persistent: true },
    );
    // Still two tabs, and neither one lost anything: the draft stays virtual and
    // unsaved, the open tab keeps its own buffer and its path.
    expect(result.current.tabs).toHaveLength(2);
    const open = result.current.tabs[0];
    const draft = result.current.tabs[1];
    if (open.kind === "file") {
      expect(open.file.path).toBe("/p/a.md");
      expect(open.file.editContent).toBe("THEIR UNSAVED WORK");
      expect(open.file.dirty).toBe(true);
    }
    if (draft.kind === "file") {
      expect(draft.file.virtual).toBe(true);
      expect(draft.file.dirty).toBe(true);
      expect(draft.file.editContent).toBe("MY DRAFT");
      expect(draft.file.path).toMatch(/^Untitled-\d+$/);
    }
  });

  it.each([
    ["the verbatim prefix", "\\\\?\\C:\\p\\a.md"],
    ["another casing", "C:\\p\\A.md"],
  ])("refuses a Save As onto an open file picked under %s", async (_how, picked) => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        document_path: spelledAs({ [picked]: "C:\\p\\a.md" }),
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue(picked);
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("C:\\p\\a.md");
    });
    const tabId = await newDraft(result, "MY DRAFT");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveTargetOpen", values: { name: "a.md" } }),
      { persistent: true },
    );
    expect(fileOf(result, 1).virtual).toBe(true);
    expect(fileOf(result, 1).editContent).toBe("MY DRAFT");
  });

  it("adopts a Save As target under its one spelling", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        document_path: spelledAs({ "c:\\p\\New.md": "C:\\p\\New.md" }),
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue("c:\\p\\New.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "HELLO");

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writesOf(writeFile)).toEqual([{ path: "C:\\p\\New.md", content: "HELLO" }]);
    expect(fileOf(result).path).toBe("C:\\p\\New.md");
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "C:\\p\\New.md" });
  });

  it("lets one of two untitled tabs take a path both are saved onto", async () => {
    // Both dialogs confirmed within one write: the check and the adoption are
    // one step for a target, so the second tab sees the first one holding it.
    // Each dialog spells the target its own way, so the queue only joins them
    // if it is keyed by the file.
    const { writeFile, started, release } = holdWrites(1, {
      document_path: spelledAs({ "/P/OUT.md": "/p/out.md" }),
    });
    const onWorkspaceNotice = vi.fn();
    vi.mocked(pickSaveDocument)
      .mockResolvedValueOnce("/p/out.md")
      .mockResolvedValueOnce("/P/OUT.md");
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const firstId = await newDraft(result, "FIRST");
    const secondId = await newDraft(result, "SECOND");

    let saves: Promise<boolean[]> | undefined;
    await act(async () => {
      saves = Promise.all([
        result.current.saveDocument(firstId),
        result.current.saveDocument(secondId),
      ]);
      await started[0].promise;
    });
    let outcome: boolean[] | undefined;
    await act(async () => {
      release[0].resolve();
      outcome = await saves;
    });

    expect(outcome).toEqual([true, false]);
    expect(writesOf(writeFile)).toEqual([{ path: "/p/out.md", content: "FIRST" }]);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveTargetOpen", values: { name: "out.md" } }),
      { persistent: true },
    );
    expect(fileOf(result, 0).path).toBe("/p/out.md");
    expect(fileOf(result, 1).virtual).toBe(true);
    expect(fileOf(result, 1).editContent).toBe("SECOND");
  });

  it("leaves the file to a tab that opened it during the Save As write", async () => {
    const { started, release } = holdWrites(1);
    const onWorkspaceNotice = vi.fn();
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/out.md");
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const draftId = await newDraft(result, "MY DRAFT");

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(draftId);
      await started[0].promise;
    });
    await act(async () => {
      await result.current.openFile("/p/out.md");
    });
    let ok: boolean | undefined;
    await act(async () => {
      release[0].resolve();
      ok = await saving;
    });

    expect(ok).toBe(false);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveTargetOpen", values: { name: "out.md" } }),
      { persistent: true },
    );
    expect(fileOf(result, 0).virtual).toBe(true);
    expect(fileOf(result, 0).editContent).toBe("MY DRAFT");
    expect(fileOf(result, 1).path).toBe("/p/out.md");
  });

  it("a Save As whose tab closes before its turn to write has nothing to save", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const spelling = deferred<string>();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        document_path: () => spelling.promise,
        write_file: writeFile as unknown as Invoker,
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "discard" as const })),
    );
    const tabId = await newDraft(result, "first");

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("document_path", { path: "/p/saved.md" }),
      );
    });
    await act(async () => {
      await result.current.closeTab(tabId);
    });
    let ok: boolean | undefined;
    await act(async () => {
      spelling.resolve("/p/saved.md");
      ok = await saving;
    });

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("Save As writes the text as it is when the dialog is confirmed", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const dialog = deferred<string | null>();
    vi.mocked(pickSaveDocument).mockReturnValue(dialog.promise);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "first");

    let saving: Promise<boolean> | undefined;
    act(() => {
      saving = result.current.saveDocument(tabId);
    });
    // The dialog does not block the editor, so typing continues behind it.
    act(() => {
      result.current.updateEditContent(tabId, "first second");
    });
    await act(async () => {
      dialog.resolve("/p/saved.md");
      await saving;
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/p/saved.md",
      content: "first second",
    });
    expect(fileOf(result).path).toBe("/p/saved.md");
    expect(fileOf(result).content).toBe("first second");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("keeps the tab dirty when an edit lands during the Save As write, and the next save writes it", async () => {
    const writeStarted = deferred();
    const writeGate = deferred();
    const writeFile = vi.fn().mockImplementation(async () => {
      writeStarted.resolve();
      await writeGate.promise;
    });
    mockWriteFile(writeFile);
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "first");

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = result.current.saveDocument(tabId);
      await writeStarted.promise;
    });
    act(() => {
      result.current.updateEditContent(tabId, "first second");
    });
    await act(async () => {
      writeGate.resolve();
      await saving;
    });

    // The write carried "first", so the tab must not go clean over the newer buffer.
    expect(writeFile).toHaveBeenCalledWith("write_file", { path: "/p/saved.md", content: "first" });
    expect(fileOf(result).path).toBe("/p/saved.md");
    expect(fileOf(result).virtual).toBe(false);
    expect(fileOf(result).editContent).toBe("first second");
    expect(fileOf(result).dirty).toBe(true);

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/saved.md",
      content: "first second",
    });
    expect(fileOf(result).content).toBe("first second");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("closing an untitled tab saves what was typed while its Save As dialog was open", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const dialog = deferred<string | null>();
    vi.mocked(pickSaveDocument).mockReturnValue(dialog.promise);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "first");

    let closing: Promise<boolean> | undefined;
    act(() => {
      closing = result.current.closeTab(tabId);
    });
    act(() => {
      result.current.updateEditContent(tabId, "first second");
    });
    let closed: boolean | undefined;
    await act(async () => {
      dialog.resolve("/p/saved.md");
      closed = await closing;
    });

    expect(closed).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/p/saved.md",
      content: "first second",
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("closing an untitled tab writes what was typed during its Save As write", async () => {
    const { writeFile, started, release } = holdWrites(1);
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "first");

    let closing: Promise<boolean> | undefined;
    await act(async () => {
      closing = result.current.closeTab(tabId);
      await started[0].promise;
    });
    act(() => {
      result.current.updateEditContent(tabId, "first second");
    });
    let closed: boolean | undefined;
    await act(async () => {
      release[0].resolve();
      closed = await closing;
    });

    expect(closed).toBe(true);
    expect(pickSaveDocument).toHaveBeenCalledTimes(1);
    expect(writesOf(writeFile)).toEqual([
      { path: "/p/saved.md", content: "first" },
      { path: "/p/saved.md", content: "first second" },
    ]);
    expect(result.current.tabs).toHaveLength(0);
  });

  // A stale dialog must not overwrite a later save or raise a discard prompt.
  it.each([
    ["confirmed", "/p/saved.md"],
    ["cancelled", null],
  ])("a Save As dialog %s after its tab was closed has nothing to save", async (_how, picked) => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const dialog = deferred<string | null>();
    vi.mocked(pickSaveDocument).mockReturnValue(dialog.promise);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved: async () => "discard" as const })),
    );
    const tabId = await newDraft(result, "first");

    let saving: Promise<boolean> | undefined;
    act(() => {
      saving = result.current.saveDocument(tabId);
    });
    // The user discards the document through the close prompt instead.
    await act(async () => {
      await result.current.closeTab(tabId);
    });
    let ok: boolean | undefined;
    await act(async () => {
      dialog.resolve(picked);
      ok = await saving;
    });

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(0);
  });

  it("an older Save As dialog confirmed last still saves the newest text", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const older = deferred<string | null>();
    const newer = deferred<string | null>();
    vi.mocked(pickSaveDocument)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "one");

    // Two dialogs pending for one tab, as Auto Save opens when typing continues.
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => {
      first = result.current.saveDocument(tabId);
    });
    act(() => {
      result.current.updateEditContent(tabId, "one two");
    });
    act(() => {
      second = result.current.saveDocument(tabId);
    });
    await act(async () => {
      newer.resolve("/p/b.md");
      await second;
    });
    act(() => {
      result.current.updateEditContent(tabId, "one two three");
    });
    await act(async () => {
      older.resolve("/p/a.md");
      await first;
    });

    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: fileOf(result).path,
      content: "one two three",
    });
    expect(fileOf(result).content).toBe("one two three");
    expect(fileOf(result).dirty).toBe(false);
  });

  it("saveDocument adopts the path outside the workspace even when the watch fails", async () => {
    const setLastFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        write_file: async () => undefined,
        watch_file: async (_cmd, args) => {
          // The pre-existing note's open is watched fine; only the saved
          // target's watcher fails to start.
          if ((args as { path: string }).path === "/save-out/note.md") {
            throw new Error("watcher failed to start");
          }
        },
        workspace_set_last_file: setLastFile as unknown as Invoker,
      }) as typeof invoke,
    );
    // Save target sits outside the open workspace, so no last-file is recorded.
    vi.mocked(pickSaveDocument).mockResolvedValue("/save-out/note.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // A second open tab so the update walk also visits a non-matching tab.
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    act(() => {
      result.current.newDocument();
    });
    const tabId = result.current.tabs.find((t) => t.kind === "file" && t.file.virtual)?.id;
    if (!tabId) throw new Error("expected a virtual tab");
    act(() => {
      result.current.updateEditContent(tabId, "HELLO");
    });

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    const tab = result.current.tabs.find(
      (t) => t.kind === "file" && t.file.path === "/save-out/note.md",
    );
    expect(tab).toBeTruthy();
    if (tab?.kind === "file") {
      expect(tab.file.virtual).toBe(false);
    }
    // The save target sits outside the workspace, so it is never recorded as
    // the workspace's last file (the earlier in-workspace open is unrelated).
    expect(setLastFile).not.toHaveBeenCalledWith(
      "workspace_set_last_file",
      expect.objectContaining({ filePath: "/save-out/note.md" }),
    );
  });

  it("saveDocument records a note saved inside the open workspace as its last file", async () => {
    const setLastFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        write_file: async () => undefined,
        workspace_set_last_file: setLastFile as unknown as Invoker,
      }) as typeof invoke,
    );
    vi.mocked(pickSaveDocument).mockResolvedValue("/p/ws/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraftInWorkspace(result, "HELLO");

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/ws",
      filePath: "/p/ws/saved.md",
    });
  });

  it("saveDocument asks again with no starting folder when the workspace root is refused", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    // The root's folder was renamed under the app, so the backend no longer
    // resolves it and refuses it as the folder to open the dialog in.
    expectConsole(/asking again with no starting folder/);
    vi.mocked(pickSaveDocument)
      .mockRejectedValueOnce("path is outside the allowed workspaces and files: /p/ws")
      .mockResolvedValueOnce("/elsewhere/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraftInWorkspace(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(true);
    expect(vi.mocked(pickSaveDocument).mock.calls.map((call) => call[3])).toEqual([
      "/p/ws",
      undefined,
    ]);
    expect(writeFile).toHaveBeenCalledWith("write_file", {
      path: "/elsewhere/saved.md",
      content: "HELLO",
    });
  });

  it("saveDocument keeps the buffer virtual when the second Save As is cancelled", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    expectConsole(/asking again with no starting folder/);
    vi.mocked(pickSaveDocument)
      .mockRejectedValueOnce("path is outside the allowed workspaces and files: /p/ws")
      .mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraftInWorkspace(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    // False routes a closing window to its unsaved-changes prompt.
    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    const tab = result.current.tabs.find((t) => t.id === tabId);
    expect(tab?.kind === "file" && tab.file.virtual).toBe(true);
  });

  // How the backend refuses a chosen name the grants will not write (a dangling link, say).
  const REFUSED = "path is outside the allowed workspaces and files: /p/link.md";

  it("saveDocument keeps the buffer and shows a notice when Save As fails", async () => {
    const onWorkspaceNotice = vi.fn();
    expectConsole(/Save As failed:/);
    vi.mocked(pickSaveDocument).mockRejectedValue(REFUSED);
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const tabId = await newDraft(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(false);
    // With no workspace there is no starting folder to drop, so no second dialog.
    expect(pickSaveDocument).toHaveBeenCalledTimes(1);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.saveFailed", values: { name: fileOf(result).path } },
      { persistent: true },
    );
    expect(fileOf(result).virtual).toBe(true);
    expect(fileOf(result).dirty).toBe(true);
    expect(fileOf(result).editContent).toBe("HELLO");
  });

  it("saveDocument keeps the buffer and shows a notice when both Save As attempts fail", async () => {
    const onWorkspaceNotice = vi.fn();
    expectConsole(/asking again with no starting folder/, /Save As failed:/);
    vi.mocked(pickSaveDocument).mockRejectedValue(REFUSED);
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    const tabId = await newDraftInWorkspace(result, "HELLO");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveDocument(tabId);
    });

    expect(ok).toBe(false);
    expect(vi.mocked(pickSaveDocument).mock.calls.map((call) => call[3])).toEqual([
      "/p/ws",
      undefined,
    ]);
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: "notice.saveFailed" }),
      { persistent: true },
    );
    const tab = result.current.tabs.find((t) => t.id === tabId);
    expect(tab?.kind === "file" && tab.file.virtual).toBe(true);
    expect(tab?.kind === "file" && tab.file.editContent).toBe("HELLO");
  });

  it("a window close reaches the unsaved-changes prompt when Save As fails", async () => {
    expectConsole(/Save As failed:/);
    vi.mocked(pickSaveDocument).mockRejectedValue(REFUSED);
    vi.mocked(ask).mockResolvedValueOnce(false);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    const tabId = await newDraft(result, "HELLO");

    // The window-close flush, unscoped; a rejection here would close the window.
    let proceed: boolean | undefined;
    await act(async () => {
      proceed = await result.current.flushForClose();
    });

    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining(fileOf(result).path),
      expect.objectContaining({ kind: "warning" }),
    );
    expect(proceed).toBe(false);
    expect(result.current.tabs.map((t) => t.id)).toEqual([tabId]);
    expect(fileOf(result).editContent).toBe("HELLO");
  });

  it("a Save As that fails after its tab was closed has nothing to save", async () => {
    const onWorkspaceNotice = vi.fn();
    expectConsole(/Save As failed:/);
    const dialog = deferred<string | null>();
    vi.mocked(pickSaveDocument).mockReturnValue(dialog.promise);
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onWorkspaceNotice,
          autoSave: false,
          confirmUnsaved: async () => "discard" as const,
        }),
      ),
    );
    const tabId = await newDraft(result, "first");

    let saving: Promise<boolean> | undefined;
    act(() => {
      saving = result.current.saveDocument(tabId);
    });
    await act(async () => {
      await result.current.closeTab(tabId);
    });
    let ok: boolean | undefined;
    await act(async () => {
      dialog.reject(REFUSED);
      ok = await saving;
    });

    // The user already discarded it, so there is nothing to report as unsaved.
    expect(ok).toBe(true);
    expect(onWorkspaceNotice).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(0);
  });
});

describe("closing untitled documents", () => {
  it.each([
    ["the window", (result: TabsHook) => result.current.flushForClose()],
    ["both tabs", (result: TabsHook, ids: string[]) => result.current.closeTabs(ids)],
  ])(
    "closing %s asks for one Save As at a time, and still asks after a cancel",
    async (_what, close) => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      mockWriteFile(writeFile);
      const first = deferred<string | null>();
      const second = deferred<string | null>();
      vi.mocked(pickSaveDocument)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      vi.mocked(ask).mockResolvedValueOnce(false);
      const { result } = renderHook(() => useTabs(defaultOptions()));
      const ids = [await newDraft(result, "one"), await newDraft(result, "two")];
      const titles = [fileOf(result, 0).path, fileOf(result, 1).path];

      let closing: Promise<boolean> | undefined;
      act(() => {
        closing = close(result, ids);
      });
      expect(pickSaveDocument).toHaveBeenCalledTimes(1);

      await deliver(() => first.resolve(null));
      expect(vi.mocked(pickSaveDocument).mock.calls.map((call) => call[0])).toEqual(
        titles.map((title) => `${title}.md`),
      );

      let proceed: boolean | undefined;
      await act(async () => {
        second.resolve("/p/two.md");
        proceed = await closing;
      });

      expect(writeFile).toHaveBeenCalledExactlyOnceWith("write_file", {
        path: "/p/two.md",
        content: "two",
      });
      // The discard prompt lists the cancelled document only.
      const message = vi.mocked(ask).mock.lastCall?.[0];
      expect(message).toContain(titles[0]);
      expect(message).not.toContain(titles[1]);
      expect(proceed).toBe(false);
      expect(result.current.tabs.map((tab) => tab.id)).toEqual(ids);
      expect(fileOf(result, 0).virtual).toBe(true);
    },
  );

  it("writes a tab with a path while an untitled tab's Save As is still open", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const dialog = deferred<string | null>();
    vi.mocked(pickSaveDocument).mockReturnValue(dialog.promise);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await newDraft(result, "draft");
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const fileId = result.current.activeTabId;
    if (!fileId) throw new Error("expected /p/a.md to be active");
    act(() => {
      result.current.setTabMode(fileId, "edit");
    });
    act(() => {
      result.current.updateEditContent(fileId, "EDITED");
    });

    let closing: Promise<boolean> | undefined;
    act(() => {
      closing = result.current.flushForClose();
    });
    await deliver(() => {});
    expect(writeFile).toHaveBeenCalledExactlyOnceWith("write_file", {
      path: "/p/a.md",
      content: "EDITED",
    });

    let proceed: boolean | undefined;
    await act(async () => {
      dialog.resolve("/p/draft.md");
      proceed = await closing;
    });
    expect(proceed).toBe(true);
    expect(writeFile).toHaveBeenLastCalledWith("write_file", {
      path: "/p/draft.md",
      content: "draft",
    });
  });

  it("asks Save / Don't Save / Cancel before any Save As when Auto Save is off", async () => {
    const confirmUnsaved = vi.fn(async () => "cancel" as const);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved })),
    );
    const tabId = await newDraft(result, "draft");

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeTab(tabId);
    });

    expect(confirmUnsaved).toHaveBeenCalledExactlyOnceWith([fileOf(result).path]);
    expect(pickSaveDocument).not.toHaveBeenCalled();
    expect(closed).toBe(false);
    expect(fileOf(result).dirty).toBe(true);
  });

  it("after Save at the Auto Save off prompt, still asks for one Save As at a time", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    mockWriteFile(writeFile);
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    vi.mocked(pickSaveDocument)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const confirmUnsaved = vi.fn(async () => "save" as const);
    const { result } = renderHook(() =>
      useTabs(defaultOptions({ autoSave: false, confirmUnsaved })),
    );
    await newDraft(result, "one");
    await newDraft(result, "two");

    let closing: Promise<boolean> | undefined;
    act(() => {
      closing = result.current.flushForClose();
    });
    await deliver(() => {});
    expect(pickSaveDocument).toHaveBeenCalledTimes(1);

    await deliver(() => first.resolve("/p/one.md"));
    expect(pickSaveDocument).toHaveBeenCalledTimes(2);

    let proceed: boolean | undefined;
    await act(async () => {
      second.resolve("/p/two.md");
      proceed = await closing;
    });
    expect(proceed).toBe(true);
    expect(writeFile.mock.calls.map((call) => call[1])).toEqual([
      { path: "/p/one.md", content: "one" },
      { path: "/p/two.md", content: "two" },
    ]);
  });
});
