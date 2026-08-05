import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFolder, pickNewWorkspace } from "@/lib/pickers";
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

describe("useTabs workspace interactions", () => {
  it("openFolder with no path prompts a dialog and routes the choice via the window manager", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/p/picked");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(pickFolder).toHaveBeenCalled();
    // The pick is handed to Rust routing (which may focus, adopt, or spawn a
    // window); the frontend does not adopt it directly here.
    expect(invoke).toHaveBeenCalledWith("request_open", { kind: "folder", path: "/p/picked" });
  });

  it("createWorkspace creates a folder and routes it via the window manager", async () => {
    vi.mocked(pickNewWorkspace).mockResolvedValue("/p/new-ws");
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.createWorkspace();
    });

    expect(pickNewWorkspace).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("request_open", { kind: "folder", path: "/p/new-ws" });
  });

  it("createWorkspace bails when the dialog is cancelled", async () => {
    vi.mocked(pickNewWorkspace).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.createWorkspace();
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "request_open",
      expect.objectContaining({ kind: "folder" }),
    );
  });

  it("openFolder bails when the directory dialog is cancelled", async () => {
    vi.mocked(pickFolder).mockResolvedValue(null);
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(result.current.workspace).toBeNull();
  });

  it("openFolder restores persisted expanded directories and pre-loads their listings", async () => {
    const readDirs: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          readDirs.push(String(args?.path ?? ""));
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFolder("/p/ws", { expanded: ["/p/ws/sub"] });
    });

    expect(readDirs).toContain("/p/ws/sub");
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(true);
  });

  it("toggleExpand is a no-op when no workspace is open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });

    expect(result.current.workspace).toBeNull();
  });

  it("toggleExpand collapses an expanded directory and reuses cached listings", async () => {
    let subReads = 0;
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          if (String(args?.path ?? "") === "/p/ws/sub") subReads += 1;
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);

    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(false);

    // Re-expanding hits the cached listing instead of re-reading the directory.
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });
    expect(result.current.workspace?.expanded.has("/p/ws/sub")).toBe(true);
    expect(subReads).toBe(1);
  });

  it("setActiveTab leaving a graph tab keeps it unchanged", async () => {
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
      await result.current.openFile("/p/a.md");
    });
    const fileId = result.current.tabs.find((t) => t.kind === "file")?.id as string;

    act(() => {
      result.current.setActiveTab(graphId);
    });
    // Leaving the graph tab: it has no file to stamp a scroll position on.
    act(() => {
      result.current.setActiveTab(fileId);
    });

    const graph = result.current.tabs.find((t) => t.id === graphId);
    expect(graph?.kind === "graph" ? graph.file : "set").toBeNull();
    expect(result.current.activeTabId).toBe(fileId);
  });

  it("setTabMode on a graph tab is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    const graphId = result.current.tabs.find((t) => t.kind === "graph")?.id as string;

    act(() => {
      result.current.setTabMode(graphId, "edit");
    });

    const graph = result.current.tabs.find((t) => t.id === graphId);
    expect(graph?.kind === "graph" ? graph.file : "set").toBeNull();
  });
});
