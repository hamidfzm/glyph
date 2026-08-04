import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFiles } from "@/lib/pickers";
import {
  captureListener,
  defaultOptions,
  fileScan,
  makeInvoker,
  resetTabsMocks,
  watchDirectoryCalls,
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

describe("useTabs opening folders", () => {
  it("openFileDialog opens each selected path", async () => {
    vi.mocked(pickFiles).mockResolvedValue(["/p/x.md", "/p/y.md"]);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFileDialog();
    });

    expect(result.current.tabs).toHaveLength(2);
  });

  it("openFileDialog is a no-op when nothing is selected", async () => {
    vi.mocked(pickFiles).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFileDialog();
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("opens a folder as the workspace and watches it", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("watch_directory", { path: "/p/ws" });
  });
  it("re-opening the same workspace root is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(watchDirectoryCalls("/p/ws")).toHaveLength(1);
  });

  it("openFile is wired to the open-file event", async () => {
    const ref = captureListener("open-file");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(ref.handler).not.toBeNull();

    await act(async () => {
      ref.handler?.({ payload: "/p/evt.md" });
    });
    await waitFor(() => {
      expect(
        result.current.tabs.some((t) => t.kind === "file" && t.file.path === "/p/evt.md"),
      ).toBe(true);
    });
  });

  it("auto-opens the first markdown file when opening a folder with no remembered file", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md", "/p/ws/b.md"]),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("auto-opens the remembered file when it still exists in the workspace", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md", "/p/ws/b.md"]),
        workspace_get_last_file: async () => "/p/ws/b.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(1);
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/b.md");
    }
  });

  it("falls back to the first file when the remembered file no longer exists", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md", "/p/ws/b.md"]),
        workspace_get_last_file: async () => "/p/ws/gone.md",
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("falls back to the first file when the remembered-file lookup fails", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md"]),
        workspace_get_last_file: async () => {
          throw new Error("state.json unreadable");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.path).toBe("/p/ws/a.md");
    }
  });

  it("does not auto-open anything when the workspace has no markdown files", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan([]),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/empty");
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("skips the auto-open probe when autoLoad is false", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md"]),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws", { autoLoad: false });
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("workspace_get_last_file", expect.anything());
  });

  it("skips auto-open when list_markdown_files returns a non-markdown target", async () => {
    // Covers the false arm of `isMarkdownFile(target)` inside the auto-open
    // branch. list_markdown_files in real life never returns non-md paths,
    // but the guard exists for defence in depth.
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/notes.txt"]),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    expect(result.current.tabs).toHaveLength(0);
  });

  it("opens the workspace without a tab when auto-opening the first file fails", async () => {
    // The auto-open goes through openFile, whose own catch logs the failure.
    // The workspace itself still opens.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async () => fileScan(["/p/ws/a.md"]),
        read_file: async () => {
          throw new Error("vanished");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    expect(result.current.workspace?.root).toBe("/p/ws");
    expect(result.current.tabs).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith("Failed to open file:", expect.anything());
    errorSpy.mockRestore();
  });

  it("opens a folder nested inside a parent git repo with a persistent warning (#262)", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: true,
          gitTopLevel: "/p/repo",
          nestedUnder: "/p/repo",
          glyphConflict: null,
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/repo/sub");
    });

    // The folder opens (no longer refused) but a persistent warning is shown.
    expect(result.current.workspace?.root).toBe("/p/repo/sub");
    expect(onWorkspaceNotice).toHaveBeenCalledWith(
      { key: "notice.nestedUnderGit", values: { path: "/p/repo" } },
      { persistent: true },
    );
  });

  it("refuses a folder nested inside another workspace's .glyph (#262)", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: "/p/outer",
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/outer/inner");
    });

    expect(result.current.workspace).toBeNull();
    expect(onWorkspaceNotice).toHaveBeenCalledWith({
      key: "notice.nestedWorkspace",
      values: { path: "/p/outer" },
    });
  });

  it("restores a nested folder silently without bannering", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async (_cmd, args) => ({
          selected: String(args?.selected ?? ""),
          isGitRepo: true,
          gitTopLevel: "/p/repo",
          nestedUnder: "/p/repo",
          glyphConflict: null,
        }),
      }) as typeof invoke,
    );
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          onWorkspaceNotice,
          openTabs: [{ kind: "folder", path: "/p/repo/sub" }],
        }),
      ),
    );
    await waitFor(() => expect(result.current.initializing).toBe(false));

    // A nested folder reopens on restore, but the warning banner stays silent.
    expect(result.current.workspace?.root).toBe("/p/repo/sub");
    expect(onWorkspaceNotice).not.toHaveBeenCalled();
  });

  it("refuses and reports when workspace resolution fails", async () => {
    const onWorkspaceNotice = vi.fn();
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        workspace_resolve: async () => {
          throw new Error("unreadable path");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ onWorkspaceNotice })));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/broken");
    });

    expect(result.current.workspace).toBeNull();
    expect(onWorkspaceNotice).toHaveBeenCalledWith({
      key: "error.couldntOpen",
      values: { error: expect.stringContaining("unreadable path") },
    });
  });

  it("openFolder is wired to the open-folder event", async () => {
    const ref = captureListener("open-folder");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(ref.handler).not.toBeNull();

    await act(async () => {
      ref.handler?.({ payload: "/p/dropped" });
    });
    await waitFor(() => {
      expect(result.current.workspace?.root).toBe("/p/dropped");
    });
  });
});
