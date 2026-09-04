import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickSave } from "@/lib/pickers";
import { EDITOR_MODE } from "@/lib/settings";
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

  it("keeps a virtual buffer's content in sync so the preview renders it", async () => {
    // Regression: the view/preview pane reads file.content, which stayed "" for
    // an unsaved buffer, so switching an untitled doc to preview showed nothing.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.newDocument();
    });
    const virtualId = result.current.tabs[0].id;
    act(() => {
      result.current.updateEditContent(virtualId, "# hello");
    });

    const virtualTab = result.current.tabs[0];
    if (virtualTab.kind === "file") {
      expect(virtualTab.file.editContent).toBe("# hello");
      expect(virtualTab.file.content).toBe("# hello");
    }
  });

  it("leaves a saved file's content untouched while editing", async () => {
    // The sync above must not leak into ordinary tabs: their content stays the
    // last-saved text until a write lands.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => "ON DISK" }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const fileId = result.current.tabs[0].id;
    act(() => {
      result.current.updateEditContent(fileId, "TYPED");
    });

    const fileTab = result.current.tabs[0];
    if (fileTab.kind === "file") {
      expect(fileTab.file.editContent).toBe("TYPED");
      expect(fileTab.file.content).toBe("ON DISK");
    }
  });

  it("saveDocument on a virtual tab writes via Save As and adopts the path", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
    vi.mocked(pickSave).mockResolvedValue("/p/saved.md");
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() => useTabs(defaultOptions({ onSettingsChange })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.newDocument();
    });
    const tabId = result.current.tabs[0].id;
    act(() => {
      result.current.updateEditContent(tabId, "HELLO");
    });

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
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ write_file: writeFile as unknown as Invoker }) as typeof invoke,
    );
    vi.mocked(pickSave).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.newDocument();
    });
    const tabId = result.current.tabs[0].id;
    act(() => {
      result.current.updateEditContent(tabId, "X");
    });

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
    vi.mocked(pickSave).mockResolvedValue("/p/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      result.current.newDocument();
    });
    const tabId = result.current.tabs[0].id;
    act(() => {
      result.current.updateEditContent(tabId, "HELLO");
    });

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
    vi.mocked(pickSave).mockResolvedValue("/p/a.md");
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

  it("saveDocument adopts the path outside the workspace even when metadata is declined", async () => {
    const setLastFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        write_file: async () => undefined,
        get_file_metadata: async (_cmd, args) => {
          // The pre-existing note's open reads metadata fine; only the saved
          // target's read is declined (write-only grant).
          if ((args as { path: string }).path === "/save-out/note.md") {
            throw new Error("no read grant");
          }
          return { name: "", path: "", size: 0, modified: 0 };
        },
        workspace_set_last_file: setLastFile as unknown as Invoker,
      }) as typeof invoke,
    );
    // Save target sits outside the open workspace, so no last-file is recorded.
    vi.mocked(pickSave).mockResolvedValue("/save-out/note.md");
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
      expect(tab.file.metadata).toBeNull();
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
    vi.mocked(pickSave).mockResolvedValue("/p/ws/saved.md");
    const { result } = renderHook(() => useTabs(defaultOptions()));
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
      result.current.updateEditContent(tabId, "HELLO");
    });

    await act(async () => {
      await result.current.saveDocument(tabId);
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/ws",
      filePath: "/p/ws/saved.md",
    });
  });
});
