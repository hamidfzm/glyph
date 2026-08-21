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

describe("useTabs tab strip", () => {
  it("closeTab removes the tab and unwatches the file", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const toClose = result.current.tabs[0].id;
    await act(async () => {
      await result.current.closeTab(toClose);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/a.md" });
  });

  it("closeTab on the active tab advances activeTabId to a neighbor", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const activeId = result.current.activeTabId;
    expect(activeId).toBe(result.current.tabs[1].id);
    await act(async () => {
      await result.current.closeTab(activeId as string);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("closeTab tolerates an unwatch_file failure", async () => {
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        unwatch_file: async () => {
          throw new Error("watcher gone");
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      await result.current.closeTab(result.current.tabs[0].id);
    });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("setActiveTab switches the active tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    const firstId = result.current.tabs[0].id;
    act(() => {
      result.current.setActiveTab(firstId);
    });

    expect(result.current.activeTabId).toBe(firstId);
  });

  it("setTabMode initializes editContent from content the first time", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.setTabMode(tabId, "edit");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.mode).toBe("edit");
      expect(result.current.tabs[0].file.editContent).toBe("FILE BODY");
    }
  });

  it("setTabMode preserves editContent when switching between non-view modes", async () => {
    // Covers the branch where mode !== view but editContent is already set, so
    // the first-time seeding is skipped and the existing edit buffer survives.
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.setTabMode(tabId, "edit");
    });
    act(() => {
      result.current.updateEditContent(tabId, "TYPED");
    });
    act(() => {
      result.current.setTabMode(tabId, "split");
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.mode).toBe("split");
      // editContent is not re-seeded from content; the typed buffer is kept.
      expect(result.current.tabs[0].file.editContent).toBe("TYPED");
    }
  });
  it("saveScrollPosition + setActiveTab persists scrollTop to the leaving tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    act(() => {
      result.current.saveScrollPosition(420);
    });
    const firstId = result.current.tabs[0].id;
    act(() => {
      result.current.setActiveTab(firstId);
    });

    const second = result.current.tabs[1];
    if (second.kind === "file") {
      expect(second.file.scrollTop).toBe(420);
    }
  });

  it("re-opening an already-open file persists scrollTop to the leaving tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });

    act(() => {
      result.current.saveScrollPosition(420);
    });
    // A wikilink or history move to an open note goes through openFile, not
    // setActiveTab; the outgoing tab's scroll must survive that route too.
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    expect(result.current.activeTab?.id).toBe(result.current.tabs[0].id);
    const second = result.current.tabs[1];
    if (second.kind === "file") {
      expect(second.file.scrollTop).toBe(420);
    }
  });

  it("navigateBack / navigateForward walk the tabs in visiting order", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.openFile("/p/a.md");
    });
    await act(async () => {
      await result.current.openFile("/p/b.md");
    });
    act(() => {
      result.current.saveScrollPosition(420);
    });

    await act(async () => {
      result.current.navigateBack();
    });
    expect(result.current.activeFile?.path).toBe("/p/a.md");

    await act(async () => {
      result.current.navigateForward();
    });
    expect(result.current.activeFile?.path).toBe("/p/b.md");
    expect(result.current.activeFile?.scrollTop).toBe(420);
  });
});

describe("useTabs moveTab / moveActiveTab", () => {
  async function renderWithTabs(activeTabPath = "/p/a.md") {
    const onSettingsChange = vi.fn();
    const { result } = renderHook(() =>
      useTabs(
        defaultOptions({
          openTabs: ["/p/a.md", "/p/b.md", "/p/c.md"],
          activeTabPath,
          onSettingsChange,
        }),
      ),
    );
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    return { result, onSettingsChange };
  }

  function paths(result: { current: ReturnType<typeof useTabs> }) {
    return result.current.tabs.map((t) => (t.kind === "file" ? t.file.path : "(graph)"));
  }

  it("moves a tab to the target index", async () => {
    const { result } = await renderWithTabs();
    const first = result.current.tabs[0];
    act(() => {
      result.current.moveTab(first.id, 2);
    });
    expect(paths(result)).toEqual(["/p/b.md", "/p/c.md", "/p/a.md"]);
  });

  it("clamps an out-of-range target index to the strip", async () => {
    const { result } = await renderWithTabs();
    const first = result.current.tabs[0];
    act(() => {
      result.current.moveTab(first.id, 99);
    });
    expect(paths(result)).toEqual(["/p/b.md", "/p/c.md", "/p/a.md"]);
  });

  it("is a no-op when the clamped target equals the current index", async () => {
    const { result } = await renderWithTabs();
    const before = result.current.tabs;
    act(() => {
      result.current.moveTab(before[2].id, 99);
    });
    expect(result.current.tabs).toBe(before);
  });

  it("is a no-op for an unknown tab id", async () => {
    const { result } = await renderWithTabs();
    const before = result.current.tabs;
    act(() => {
      result.current.moveTab("nope", 0);
    });
    expect(result.current.tabs).toBe(before);
  });

  it("keeps the active tab and per-tab state across a reorder", async () => {
    const { result } = await renderWithTabs("/p/b.md");
    const activeBefore = result.current.activeTabId;
    const first = result.current.tabs[0];
    act(() => {
      result.current.moveTab(first.id, 2);
    });
    expect(result.current.activeTabId).toBe(activeBefore);
    const moved = result.current.tabs[2];
    expect(moved.kind).toBe("file");
    if (moved.kind === "file") {
      expect(moved.file.content).toBe("FILE BODY");
      expect(moved.file.dirty).toBe(false);
    }
  });

  it("moveActiveTab moves the active tab by the delta", async () => {
    const { result } = await renderWithTabs("/p/a.md");
    act(() => {
      result.current.moveActiveTab(1);
    });
    expect(paths(result)).toEqual(["/p/b.md", "/p/a.md", "/p/c.md"]);
    act(() => {
      result.current.moveActiveTab(-1);
    });
    expect(paths(result)).toEqual(["/p/a.md", "/p/b.md", "/p/c.md"]);
  });

  it("moveActiveTab is a no-op at the ends of the strip", async () => {
    const { result } = await renderWithTabs("/p/a.md");
    const before = result.current.tabs;
    act(() => {
      result.current.moveActiveTab(-1);
    });
    expect(result.current.tabs).toBe(before);
  });

  it("moveActiveTab is a no-op with no active tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    act(() => {
      result.current.moveActiveTab(1);
    });
    expect(result.current.tabs).toEqual([]);
  });

  it("persists the reordered tab list", async () => {
    const { result, onSettingsChange } = await renderWithTabs();
    const first = result.current.tabs[0];
    act(() => {
      result.current.moveTab(first.id, 2);
    });
    await waitFor(() => {
      const calls = onSettingsChange.mock.calls.filter((c) => c[0] === "behavior.openTabs");
      const last = calls[calls.length - 1]?.[1] as { kind: string; path: string }[];
      expect(last.map((t) => t.path)).toEqual(["/p/b.md", "/p/c.md", "/p/a.md"]);
    });
  });

  it("closeTabs removes a batch in one pass and unwatches each file", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    for (const path of ["/p/a.md", "/p/b.md", "/p/c.md"]) {
      await act(async () => {
        await result.current.openFile(path);
      });
    }

    const [first, , third] = result.current.tabs.map((t) => t.id);
    await act(async () => {
      await result.current.closeTabs([first, third]);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/a.md" });
    expect(invoke).toHaveBeenCalledWith("unwatch_file", { path: "/p/c.md" });
  });

  it("closeTabs activates a survivor when the batch includes the active tab", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));

    for (const path of ["/p/a.md", "/p/b.md", "/p/c.md"]) {
      await act(async () => {
        await result.current.openFile(path);
      });
    }

    const ids = result.current.tabs.map((t) => t.id);
    expect(result.current.activeTabId).toBe(ids[2]);
    await act(async () => {
      await result.current.closeTabs([ids[1], ids[2]]);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(ids[0]);
  });

  it("closeTabs ignores ids that are no longer open", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      await result.current.closeTabs(["gone"]);
    });

    expect(result.current.tabs).toHaveLength(1);
  });

  it("closeTabs on an empty batch is a no-op", async () => {
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      await result.current.closeTabs([]);
    });

    expect(result.current.tabs).toHaveLength(1);
  });
});
