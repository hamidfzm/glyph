import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TabsContext,
  type TabsContextValue,
  useTabsContext,
  useWorkspaceRoot,
} from "./TabsContext";
import { TabsProvider } from "./TabsProvider";

// Mock invoke so opening a file resolves with content/metadata. `read_file`
// echoes a marker derived from the path so we can assert which file is active.
function mockInvokeOpening(content: string) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "get_initial_folder":
      case "get_initial_file":
        return Promise.resolve(null);
      case "read_file":
        return Promise.resolve(content);
      case "get_file_metadata":
        return Promise.resolve({
          name:
            String(args?.path ?? "")
              .split("/")
              .pop() ?? "",
          path: String(args?.path ?? ""),
          size: 0,
          modified: 0,
        });
      default:
        return Promise.resolve(undefined);
    }
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

function wrap() {
  // TabsProvider reads settings from SettingsContext, which defaults to
  // DEFAULT_SETTINGS when no SettingsProvider is mounted.
  return ({ children }: { children: ReactNode }) => <TabsProvider>{children}</TabsProvider>;
}

describe("TabsProvider", () => {
  it("exposes the useTabs API plus derived displayContent/toc/backlinks", async () => {
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    expect(result.current.displayContent).toBeNull();
    expect(result.current.tocEntries).toEqual([]);
    expect(result.current.backlinks).toEqual([]);
    expect(typeof result.current.openFile).toBe("function");
    expect(typeof result.current.openFolder).toBe("function");
  });

  it("throws a clear error when the hook is used outside the provider", () => {
    expect(() => renderHook(() => useTabsContext())).toThrow(/TabsProvider/);
  });

  it("suppresses displayContent for a notebook (raw JSON is never the body)", async () => {
    mockInvokeOpening('{"cells": []}');
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/work/analysis.ipynb");
    });
    expect(result.current.activeFile?.path).toBe("/work/analysis.ipynb");
    // Even though the file has content, displayContent is null for notebooks.
    expect(result.current.displayContent).toBeNull();
  });

  it("projects canvas card text into displayContent and keeps the outline empty", async () => {
    mockInvokeOpening(
      JSON.stringify({
        nodes: [
          { id: "a", type: "text", text: "# Hi from card", x: 0, y: 0, width: 200, height: 80 },
        ],
        edges: [],
      }),
    );
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/work/board.canvas");
    });
    // Word count / AI / read-aloud see the card prose, not the raw JSON.
    expect(result.current.displayContent).toBe("# Hi from card");
    // The board has no heading scroll targets, so the heading above must not
    // produce a TOC entry.
    expect(result.current.tocEntries).toEqual([]);
  });

  it("suppresses displayContent for an empty canvas file", async () => {
    mockInvokeOpening("");
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/work/blank.canvas");
    });
    expect(result.current.displayContent).toBeNull();
  });

  it("derives displayContent from editContent in edit mode for markdown", async () => {
    mockInvokeOpening("# saved");
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/work/notes.md");
    });
    const id = result.current.activeTabId as string;
    // View mode → displayContent is the saved content.
    expect(result.current.displayContent).toBe("# saved");

    await act(async () => {
      result.current.setTabMode(id, "edit");
    });
    // Entering edit mode seeds editContent from content; before any typing the
    // `editContent ?? content` fallback resolves to the saved content.
    expect(result.current.displayContent).toBe("# saved");

    await act(async () => {
      result.current.updateEditContent(id, "# editing");
    });
    // After typing, displayContent reflects the in-memory editContent.
    expect(result.current.displayContent).toBe("# editing");
  });

  it("opens the file returned by get_initial_file (CLI path) on mount", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "get_initial_folder":
          return Promise.resolve(null);
        case "get_initial_file":
          return Promise.resolve("/cli/file.md");
        case "read_file":
          return Promise.resolve("# Hello");
        case "get_file_metadata":
          return Promise.resolve({
            name: "file.md",
            path: String(args?.path ?? ""),
            size: 0,
            modified: 0,
          });
        case "watch_file":
        case "watch_directory":
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(undefined);
      }
    }) as unknown as typeof invoke);

    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTab?.kind).toBe("file");
    if (result.current.activeTab?.kind === "file") {
      expect(result.current.activeTab.file.path).toBe("/cli/file.md");
      expect(result.current.activeTab.file.content).toBe("# Hello");
    }
  });
});

describe("useWorkspaceRoot", () => {
  it("returns undefined when no provider is mounted", () => {
    const { result } = renderHook(() => useWorkspaceRoot());
    expect(result.current).toBeUndefined();
  });

  it("returns the open workspace root from the tabs context", () => {
    const tabs = { workspace: { root: "/repo" } } as unknown as TabsContextValue;
    const { result } = renderHook(() => useWorkspaceRoot(), {
      wrapper: ({ children }) => (
        <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
      ),
    });
    expect(result.current).toBe("/repo");
  });

  it("returns undefined when no folder workspace is open", () => {
    const tabs = { workspace: null } as unknown as TabsContextValue;
    const { result } = renderHook(() => useWorkspaceRoot(), {
      wrapper: ({ children }) => (
        <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
      ),
    });
    expect(result.current).toBeUndefined();
  });
});
