import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOptions, makeInvoker, resetTabsMocks } from "@/test/tabsHarness";
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

describe("useTabs opening documents", () => {
  it("opens a new file tab on openFile", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/new.md");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTab?.id).toBe(result.current.tabs[0].id);
  });

  it("refuses to open a file whose extension isn't a supported type", async () => {
    // openFile gates unsupported extensions so a random `.txt` / `.html`
    // can't reach the renderer with embedded HTML / JS.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/evil.txt");
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    warnSpy.mockRestore();
  });

  it("opens a Jupyter notebook in view mode", async () => {
    // `.ipynb` is a supported type and is forced into view mode (read-only)
    // regardless of the default editor mode.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/analysis.ipynb");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.mode : null).toBe("view");
  });

  it("opens a .d2 file in view mode with the body fence-wrapped as a d2 block", async () => {
    // `.d2` is the D2 diagram language: the whole file body is diagram source,
    // so it's fence-wrapped (rendered via the markdown path) and opened
    // read-only, since an editor would write the wrapper back over the source.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/diagram.d2");
    });

    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.mode : null).toBe("view");
    const content = tab.kind === "file" ? tab.file.content : null;
    expect(content).toContain("```d2");
    expect(content).toContain("FILE BODY");
  });

  it("opens an image in view mode without reading it as text", async () => {
    // Images are binary: openFile must skip read_file (and the file watch)
    // entirely and load metadata only, opening the read-only image viewer.
    const { result } = renderHook(() =>
      useTabs({ ...defaultOptions(), defaultEditorMode: "edit" }),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/diagram.svg");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.kind === "file" ? tab.file.mode : null).toBe("view");
    expect(tab.kind === "file" ? tab.file.content : "x").toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/diagram.svg" });
    expect(invoke).not.toHaveBeenCalledWith("watch_file", { path: "/p/diagram.svg" });
    expect(invoke).toHaveBeenCalledWith("get_file_metadata", { path: "/p/diagram.svg" });
  });

  it("never marks a notebook tab dirty when toggled into edit mode", async () => {
    // Notebooks are read-only: switching modes shows the JSON source view, not
    // an editor. The tab must never become dirty, or autosave would write the
    // raw JSON back and could corrupt the notebook.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/analysis.ipynb");
    });
    const id = result.current.tabs[0].id;

    await act(async () => {
      result.current.setTabMode(id, "edit");
    });

    const tab = result.current.tabs[0];
    const file = tab.kind === "file" ? tab.file : null;
    expect(file?.mode).toBe("edit");
    expect(file?.dirty).toBe(false);
  });

  it("activates the existing tab instead of duplicating", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/x.md");
    });
    await act(async () => {
      await result.current.openFile("/p/y.md");
    });
    await act(async () => {
      await result.current.openFile("/p/x.md");
    });

    expect(result.current.tabs).toHaveLength(2);
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/p/x.md");
    }
  });

  it("records a workspace note via workspace_set_last_file on open", async () => {
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/ws",
      filePath: "/p/ws/note.md",
    });
  });

  it("does not record a loose file outside the workspace as the last file", async () => {
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/q/loose.md");
    });

    expect(setLastFile).not.toHaveBeenCalled();
  });

  it("still opens the tab when workspace_set_last_file fails", async () => {
    // The remember-last-file write is fire-and-forget; a failure is never
    // fatal to opening the document.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_set_last_file: async () => {
          throw new Error("state.json unwritable");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFile("/p/ws/note.md");
    });

    expect(
      result.current.tabs.some((t) => t.kind === "file" && t.file.path === "/p/ws/note.md"),
    ).toBe(true);
  });

  it("treats a file path equal to the workspace root as inside the workspace", async () => {
    // Defensive equality arm of the membership check. A root that is itself a
    // file path can't happen through the UI, but the guard exists and the
    // mocks don't care what the root looks like.
    const setLastFile = vi.fn(async () => undefined);
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ workspace_set_last_file: setLastFile }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/odd.md");
    });
    setLastFile.mockClear();

    await act(async () => {
      await result.current.openFile("/p/odd.md");
    });

    expect(setLastFile).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p/odd.md",
      filePath: "/p/odd.md",
    });
  });
});

describe("mobile file opening", () => {
  // These tests flip the platform mock to mobile; restore it so later describes
  // don't silently take the mobile read path.
  afterEach(async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("macos");
  });

  it("reads picked files via the fs plugin and skips metadata and watch", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(readTextFile).mockResolvedValue("# from the picker");

    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("content://com.provider/doc.md");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeFile?.content).toBe("# from the picker");
    expect(result.current.activeFile?.metadata).toBeNull();
    expect(vi.mocked(readTextFile)).toHaveBeenCalledWith("content://com.provider/doc.md");
    const commands = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(commands).not.toContain("read_file");
    expect(commands).not.toContain("get_file_metadata");
    expect(commands).not.toContain("watch_file");
  });

  it("opens an extensionless Android content URI instead of refusing it", async () => {
    // Android's document picker returns opaque `content://` URIs with no file
    // extension, so the extension-based support gate can't classify them; the
    // picker's type filter already restricted the choice, so they must open.
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(readTextFile).mockResolvedValue("# picked");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile(
        "content://com.android.providers.media.documents/document/document%3A1000000036",
      );
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeFile?.content).toBe("# picked");
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    warnSpy.mockRestore();
  });

  it("opens picked images without Rust-side metadata", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");

    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("content://com.provider/photo.png");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeFile?.metadata).toBeNull();
    const commands = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(commands).not.toContain("get_file_metadata");
  });
});
