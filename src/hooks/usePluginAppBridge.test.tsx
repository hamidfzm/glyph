import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { locateLineInDocument } from "@/lib/documentHighlight";
import { pluginAppState } from "@/lib/plugins/appState";
import { createNavigationApi } from "@/lib/plugins/navigationApi";
import { makeFileState } from "@/lib/tabs";
import { deferred } from "@/test/deferred";
import { sidebarLayoutValue } from "@/test/fixtures/sidebarLayout";
import { tabsContextValue } from "@/test/fixtures/tabsContext";
import { vaultSnapshot } from "@/test/tabsHarness";
import { usePluginAppBridge } from "./usePluginAppBridge";

vi.mock("@/lib/documentHighlight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documentHighlight")>()),
  locateLineInDocument: vi.fn(() => true),
}));

const workspace = { root: "/ws", expanded: new Set<string>(), nodes: new Map() };
const navigation = createNavigationApi(() => "/ws");

function renderBridge(tabs: Partial<TabsContextValue> = {}, layout = sidebarLayoutValue()) {
  let value = tabsContextValue(tabs);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={value}>
      <SidebarLayoutContext.Provider value={layout}>{children}</SidebarLayoutContext.Provider>
    </TabsContext.Provider>
  );
  const view = renderHook(() => usePluginAppBridge(), { wrapper });
  const setTabs = (next: Partial<TabsContextValue>) => {
    value = tabsContextValue(next);
    view.rerender();
  };
  return { ...view, setTabs };
}

/** An `openFile` that lands on `tabId`; undefined is "nothing opened here". */
function opening(tabId: string | undefined) {
  return vi.fn(async (_path: string) => tabId);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(locateLineInDocument).mockReset();
  vi.mocked(locateLineInDocument).mockReturnValue(true);
});

afterEach(() => vi.useRealTimers());

describe("usePluginAppBridge", () => {
  it("mirrors the workspace root, the index, and the active document", () => {
    const snapshot = vaultSnapshot(["/ws/a.md"]);
    const activeFile = { ...makeFileState("/ws/a.md", "view"), content: "# A" };
    renderBridge({ workspace, snapshot, activeFile });

    expect(pluginAppState()).toEqual({
      workspaceRoot: "/ws",
      activeDocument: { path: "/ws/a.md", text: "# A" },
      snapshot,
    });
  });

  it("mirrors unsaved edits rather than the saved text", () => {
    const activeFile = { ...makeFileState("/ws/a.md", "edit"), content: "old", editContent: "new" };
    renderBridge({ workspace, activeFile });
    expect(pluginAppState().activeDocument?.text).toBe("new");
  });

  // Empty is loaded content; null is a document still loading (INV-2).
  it("tells an empty document from one that is still loading", () => {
    const loading = makeFileState("/ws/a.md", "view");
    const { setTabs } = renderBridge({ workspace, activeFile: loading });
    expect(pluginAppState().activeDocument).toEqual({ path: "/ws/a.md", text: null });

    setTabs({ workspace, activeFile: { ...loading, content: "" } });
    expect(pluginAppState().activeDocument).toEqual({ path: "/ws/a.md", text: "" });
  });

  it("reports no workspace and no document when nothing is open", () => {
    renderBridge();
    expect(pluginAppState().workspaceRoot).toBeNull();
    expect(pluginAppState().activeDocument).toBeNull();
  });

  it("opens the file a plugin navigates to", async () => {
    const openFile = opening("tab-b");
    renderBridge({ workspace, openFile });
    navigation.openFile("/ws/b.md");

    expect(openFile).toHaveBeenCalledExactlyOnceWith("/ws/b.md");
    await vi.runAllTimersAsync();
    expect(locateLineInDocument).not.toHaveBeenCalled();
  });

  it("scrolls to the requested line once the note's tab is open", async () => {
    const open = deferred<string | undefined>();
    renderBridge({ workspace, openFile: vi.fn(() => open.promise) });
    navigation.openFile("/ws/b.md", { line: 7 });

    // Until then the viewer still shows the previous note, whose line 7 is not
    // the one that was asked for.
    await vi.runAllTimersAsync();
    expect(locateLineInDocument).not.toHaveBeenCalled();

    open.resolve("tab-b");
    await vi.runAllTimersAsync();
    expect(locateLineInDocument).toHaveBeenCalledWith(7);
  });

  // Another window holds the note, or it would not open: nothing landed here.
  it("leaves the note on screen alone when the open produced no tab", async () => {
    renderBridge({ workspace, openFile: opening(undefined) });
    navigation.openFile("/ws/b.md", { line: 7 });

    await vi.runAllTimersAsync();
    expect(locateLineInDocument).not.toHaveBeenCalled();
  });

  // A second jump abandons the first: its line belongs to another document.
  it("abandons a pending jump when the plugin navigates again", async () => {
    renderBridge({ workspace, openFile: opening("tab") });
    navigation.openFile("/ws/b.md", { line: 7 });
    await vi.advanceTimersByTimeAsync(0);
    navigation.openFile("/ws/c.md", { line: 2 });

    await vi.runAllTimersAsync();
    expect(locateLineInDocument).toHaveBeenCalledWith(2);
    expect(locateLineInDocument).not.toHaveBeenCalledWith(7);
  });

  it("drops the line of an open that finishes after a newer navigation", async () => {
    const slow = deferred<string | undefined>();
    const openFile = vi
      .fn<(path: string) => Promise<string | undefined>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue("tab-c");
    renderBridge({ workspace, openFile });
    navigation.openFile("/ws/b.md", { line: 7 });
    navigation.openFile("/ws/c.md", { line: 2 });

    slow.resolve("tab-b");
    await vi.runAllTimersAsync();
    expect(locateLineInDocument).toHaveBeenCalledWith(2);
    expect(locateLineInDocument).not.toHaveBeenCalledWith(7);
  });

  // On a phone the sidebar is a drawer over the document.
  it("dismisses the phone drawers after opening a file", () => {
    const closeCompactPanels = vi.fn();
    renderBridge(
      { workspace, openFile: opening("tab") },
      sidebarLayoutValue({ compact: true, closeCompactPanels }),
    );
    navigation.openFile("/ws/b.md");
    expect(closeCompactPanels).toHaveBeenCalledOnce();
  });

  it("leaves the desktop sidebar alone", () => {
    const closeCompactPanels = vi.fn();
    renderBridge(
      { workspace, openFile: opening("tab") },
      sidebarLayoutValue({ closeCompactPanels }),
    );
    navigation.openFile("/ws/b.md");
    expect(closeCompactPanels).not.toHaveBeenCalled();
  });

  it("stops opening files and abandons a pending jump on unmount", async () => {
    const openFile = opening("tab");
    const { unmount } = renderBridge({ workspace, openFile });
    navigation.openFile("/ws/b.md", { line: 7 });
    unmount();

    await vi.runAllTimersAsync();
    expect(locateLineInDocument).not.toHaveBeenCalled();
    navigation.openFile("/ws/c.md");
    expect(openFile).toHaveBeenCalledOnce();
  });

  it("abandons a jump already polling for its line on unmount", async () => {
    vi.mocked(locateLineInDocument).mockReturnValue(false);
    const { unmount } = renderBridge({ workspace, openFile: opening("tab") });
    navigation.openFile("/ws/b.md", { line: 7 });
    await vi.advanceTimersByTimeAsync(60);
    const attempts = vi.mocked(locateLineInDocument).mock.calls.length;
    expect(attempts).toBeGreaterThan(0);

    unmount();
    await vi.runAllTimersAsync();
    expect(locateLineInDocument).toHaveBeenCalledTimes(attempts);
  });
});
