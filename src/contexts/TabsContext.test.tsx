import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { TabsProvider, useTabsContext } from "./TabsContext";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

function wrap() {
  return ({ children }: { children: ReactNode }) => (
    <TabsProvider settings={DEFAULT_SETTINGS} updateSettings={vi.fn()}>
      {children}
    </TabsProvider>
  );
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
