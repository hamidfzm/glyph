import { invoke } from "@tauri-apps/api/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowRegistrySync } from "@/hooks/useWindowRegistrySync";
import { isCliExportProcess } from "@/lib/cliExport";
import type { Tab, Workspace } from "@/lib/tabs";

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

function workspace(root: string): Workspace {
  return { root, nodes: new Map(), expanded: new Set() } as Workspace;
}

function reportedPaths() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "set_window_files")
    .map(([, args]) => (args as { paths: string[] }).paths);
}

function reportedRoots() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "set_window_workspace")
    .map(([, args]) => (args as { root: string | null }).root);
}

describe("useWindowRegistrySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isCliExportProcess).mockReturnValue(false);
  });

  it("reports the window's workspace and file tabs", () => {
    renderHook(() => useWindowRegistrySync(workspace("/ws"), [fileTab("a", "/ws/one.md")], false));

    expect(reportedRoots()).toEqual(["/ws"]);
    expect(reportedPaths()).toEqual([["/ws/one.md"]]);
  });

  it("stays silent until the window has finished initializing", () => {
    // A spawned window is pre-registered against the path it was created for.
    // Reporting an empty window before the injected open is adopted would erase
    // that, letting a second request for the same note spawn a twin.
    const { rerender } = renderHook(
      ({ tabs, initializing }) => useWindowRegistrySync(null, tabs, initializing),
      { initialProps: { tabs: [] as Tab[], initializing: true } },
    );
    expect(invoke).not.toHaveBeenCalled();

    rerender({ tabs: [fileTab("a", "/ws/one.md")], initializing: true });
    expect(invoke).not.toHaveBeenCalled();

    rerender({ tabs: [fileTab("a", "/ws/one.md")], initializing: false });
    expect(reportedPaths()).toEqual([["/ws/one.md"]]);
    expect(reportedRoots()).toEqual([null]);
  });

  it("reports again when a tab opens or closes", () => {
    const { rerender } = renderHook(({ tabs }) => useWindowRegistrySync(null, tabs, false), {
      initialProps: { tabs: [fileTab("a", "/ws/one.md")] },
    });
    rerender({ tabs: [fileTab("a", "/ws/one.md"), fileTab("b", "/ws/two.md")] });
    rerender({ tabs: [fileTab("b", "/ws/two.md")] });

    expect(reportedPaths()).toEqual([["/ws/one.md"], ["/ws/one.md", "/ws/two.md"], ["/ws/two.md"]]);
  });

  it("reports again when the workspace changes or is closed", () => {
    const { rerender } = renderHook(({ ws }) => useWindowRegistrySync(ws, [], false), {
      initialProps: { ws: workspace("/ws") as Workspace | null },
    });
    rerender({ ws: workspace("/other") });
    rerender({ ws: null });

    expect(reportedRoots()).toEqual(["/ws", "/other", null]);
  });

  it("skips virtual buffers and graph tabs, which have no path to route to", () => {
    renderHook(() =>
      useWindowRegistrySync(
        null,
        [fileTab("a", "/ws/one.md"), fileTab("b", "Untitled-1", true), graphTab("c", "/ws")],
        false,
      ),
    );

    expect(reportedPaths()).toEqual([["/ws/one.md"]]);
  });

  it("reports an empty list once the last tab closes", () => {
    const { rerender } = renderHook(({ tabs }) => useWindowRegistrySync(null, tabs, false), {
      initialProps: { tabs: [fileTab("a", "/ws/one.md")] },
    });
    rerender({ tabs: [] as Tab[] });

    expect(reportedPaths().at(-1)).toEqual([]);
  });

  it("does not collide two tab lists that differ only by a newline in a path", () => {
    // A newline is legal in a POSIX path, so it cannot be the list separator.
    const { rerender } = renderHook(({ tabs }) => useWindowRegistrySync(null, tabs, false), {
      initialProps: { tabs: [fileTab("a", "/ws/a\nb.md")] },
    });
    rerender({ tabs: [fileTab("a", "/ws/a"), fileTab("b", "b.md")] });

    expect(reportedPaths()).toEqual([["/ws/a\nb.md"], ["/ws/a", "b.md"]]);
  });

  it("stays silent in a headless export process", () => {
    // --export skips single-instance forwarding, so that process has its own
    // registry and nothing worth reporting into it.
    vi.mocked(isCliExportProcess).mockReturnValue(true);
    renderHook(() => useWindowRegistrySync(workspace("/ws"), [fileTab("a", "/ws/one.md")], false));

    expect(invoke).not.toHaveBeenCalled();
  });

  it("survives a rejected report", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no window"));
    expect(() =>
      renderHook(() => useWindowRegistrySync(null, [fileTab("a", "/ws/one.md")], false)),
    ).not.toThrow();
    await Promise.resolve();
  });
});
