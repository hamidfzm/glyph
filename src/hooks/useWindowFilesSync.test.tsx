import { invoke } from "@tauri-apps/api/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowFilesSync } from "@/hooks/useWindowFilesSync";
import { isCliExportProcess } from "@/lib/cliExport";
import type { Tab } from "@/lib/tabs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/cliExport", () => ({ isCliExportProcess: vi.fn(() => false) }));

function fileTab(id: string, path: string, virtual = false): Tab {
  return {
    id,
    kind: "file",
    file: { path, content: "", mode: "view", dirty: false, metadata: null, virtual },
  } as Tab;
}

function graphTab(id: string, root: string): Tab {
  return { id, kind: "graph", root } as Tab;
}

function reportedPaths() {
  return vi.mocked(invoke).mock.calls.map(([, args]) => (args as { paths: string[] }).paths);
}

describe("useWindowFilesSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isCliExportProcess).mockReturnValue(false);
  });

  it("reports the window's file tab paths", () => {
    renderHook(() => useWindowFilesSync([fileTab("a", "/ws/one.md")]));

    expect(invoke).toHaveBeenCalledWith("set_window_files", { paths: ["/ws/one.md"] });
  });

  it("reports again when a tab opens or closes", () => {
    const { rerender } = renderHook(({ tabs }) => useWindowFilesSync(tabs), {
      initialProps: { tabs: [fileTab("a", "/ws/one.md")] },
    });
    rerender({ tabs: [fileTab("a", "/ws/one.md"), fileTab("b", "/ws/two.md")] });
    rerender({ tabs: [fileTab("b", "/ws/two.md")] });

    expect(reportedPaths()).toEqual([["/ws/one.md"], ["/ws/one.md", "/ws/two.md"], ["/ws/two.md"]]);
  });

  it("skips virtual buffers and graph tabs, which have no path to route to", () => {
    renderHook(() =>
      useWindowFilesSync([
        fileTab("a", "/ws/one.md"),
        fileTab("b", "Untitled-1", true),
        graphTab("c", "/ws"),
      ]),
    );

    expect(invoke).toHaveBeenCalledWith("set_window_files", { paths: ["/ws/one.md"] });
  });

  it("reports an empty list once the last tab closes", () => {
    const { rerender } = renderHook(({ tabs }) => useWindowFilesSync(tabs), {
      initialProps: { tabs: [fileTab("a", "/ws/one.md")] },
    });
    rerender({ tabs: [] as Tab[] });

    expect(reportedPaths().at(-1)).toEqual([]);
  });

  it("stays silent in a headless export process", () => {
    // Its throwaway window would otherwise absorb open requests on its way out.
    vi.mocked(isCliExportProcess).mockReturnValue(true);
    renderHook(() => useWindowFilesSync([fileTab("a", "/ws/one.md")]));

    expect(invoke).not.toHaveBeenCalled();
  });

  it("survives a rejected report", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no window"));
    expect(() => renderHook(() => useWindowFilesSync([fileTab("a", "/ws/one.md")]))).not.toThrow();
    await Promise.resolve();
  });
});
