import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { activeFileOf, type FileTab, type GraphTab, type Tab } from "@/lib/tabs";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
import { sidebarLayoutValue } from "@/test/fixtures/sidebarLayout";
import { TabBar } from "./TabBar";

const makeFileTab = (i: number): FileTab => ({
  id: `tab-${i}`,
  kind: "file",
  file: {
    path: `/path/to/file${i}.md`,
    content: `# File ${i}`,
    metadata: { name: `file${i}.md`, path: `/path/to/file${i}.md`, size: 100, modified: 0 },
    scrollTop: 0,
    mode: "view",
    editContent: null,
    dirty: false,
    virtual: false,
    revision: 0,
  },
});

const makeGraphTab = (i: number, root: string): GraphTab => ({
  id: `tab-${i}`,
  kind: "graph",
  root,
  file: null,
});

const makeTabs = (count: number): Tab[] => Array.from({ length: count }, (_, i) => makeFileTab(i));

interface RenderOpts {
  tabs?: Tab[];
  activeTabId?: string | null;
  workspace?: TabsContextValue["workspace"];
  setActiveTab?: (id: string) => void;
  closeTab?: (id: string) => Promise<boolean>;
  closeTabs?: (ids: string[]) => Promise<boolean>;
  setTabMode?: TabsContextValue["setTabMode"];
  moveTab?: (id: string, toIndex: number) => void;
  tocEntries?: TabsContextValue["tocEntries"];
  openFileDialog?: TabsContextValue["openFileDialog"];
  sidebar?: Partial<SidebarLayoutContextValue>;
}

function buildContext(opts: RenderOpts): TabsContextValue {
  const tabs = opts.tabs ?? [];
  const activeTabId = opts.activeTabId ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  return {
    tabs,
    activeTab,
    activeTabId,
    activeFile: activeFileOf(activeTab),
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    metadataEntries: [],
    metadata: new Map(),
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: opts.workspace ?? null,
    newDocument: vi.fn(),
    openFile: vi.fn(),
    openFolder: vi.fn(),
    createWorkspace: vi.fn(),
    openGraph: vi.fn(),
    closeWorkspace: vi.fn(),
    toggleExpand: vi.fn(),
    createNote: vi.fn(),
    createNoteInWorkspace: vi.fn(),
    createCanvasInWorkspace: vi.fn(),
    createCanvas: vi.fn(),
    commitEdit: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    duplicatePath: vi.fn(),
    movePath: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    deletePath: vi.fn(),
    closeTab: opts.closeTab ?? vi.fn(),
    closeTabs: opts.closeTabs ?? vi.fn(),
    setActiveTab: opts.setActiveTab ?? vi.fn(),
    setTabMode: opts.setTabMode ?? vi.fn(),
    moveTab: opts.moveTab ?? vi.fn(),
    moveActiveTab: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    updateEditContent: vi.fn(),
    saveDocument: vi.fn(),
    flushForClose: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: opts.openFileDialog ?? vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: opts.tocEntries ?? [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
  };
}

function Wrapper({
  value,
  sidebar,
  children,
}: {
  value: TabsContextValue;
  sidebar: SidebarLayoutContextValue;
  children: ReactNode;
}) {
  return (
    <TabsContext.Provider value={value}>
      <SidebarLayoutContext.Provider value={sidebar}>{children}</SidebarLayoutContext.Provider>
    </TabsContext.Provider>
  );
}

function renderTabBar(opts: RenderOpts = {}, onToggleAIChat: (() => void) | null = null) {
  const value = buildContext(opts);
  const sidebar = sidebarLayoutValue(opts.sidebar);
  return {
    ...render(
      <Wrapper value={value} sidebar={sidebar}>
        <TabBar onToggleAIChat={onToggleAIChat} onOpenPalette={vi.fn()} />
      </Wrapper>,
    ),
    value,
    sidebar,
  };
}

describe("TabBar", () => {
  it("keeps the action buttons but shows no tabs when nothing is open", () => {
    const { container } = renderTabBar({
      tabs: [],
      workspace: { root: "/vault", expanded: new Set(), nodes: new Map() },
    });
    expect(container.querySelectorAll(".tab-item")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Command palette" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open graph" })).toBeTruthy();
  });

  it("shows the AI chat toggle only when a callback is provided", () => {
    const onToggleAIChat = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0" }, onToggleAIChat);
    fireEvent.click(screen.getByRole("button", { name: "AI Chat" }));
    expect(onToggleAIChat).toHaveBeenCalled();
  });

  it("hides the AI chat toggle when no provider is configured (null callback)", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0" }, null);
    expect(screen.queryByRole("button", { name: "AI Chat" })).not.toBeInTheDocument();
  });

  it("renders tab items with file names", () => {
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-0" });
    expect(screen.getByText("file0.md")).toBeInTheDocument();
    expect(screen.getByText("file1.md")).toBeInTheDocument();
    expect(screen.getByText("file2.md")).toBeInTheDocument();
  });

  it("highlights the active tab", () => {
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-1" });
    const activeTab = screen.getByText("file1.md").closest(".tab-item");
    expect(activeTab?.getAttribute("data-active")).toBe("true");
  });

  it("calls setActiveTab when clicking a tab", () => {
    const setActiveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0", setActiveTab });
    fireEvent.click(screen.getByText("file1.md"));
    expect(setActiveTab).toHaveBeenCalledWith("tab-1");
  });

  it("calls closeTab when clicking close button", () => {
    const closeTab = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", closeTab });
    fireEvent.click(screen.getByRole("button", { name: "Close file0.md" }));
    expect(closeTab).toHaveBeenCalledWith("tab-0");
  });

  it("calls closeTab on middle-click", () => {
    const closeTab = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", closeTab });
    const tabEl = screen.getByText("file0.md").closest(".tab-item")!;
    fireEvent(tabEl, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(closeTab).toHaveBeenCalledWith("tab-0");
  });

  it("ignores aux clicks from buttons other than middle", () => {
    const closeTab = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", closeTab });
    const tabEl = screen.getByText("file0.md").closest(".tab-item")!;
    fireEvent(tabEl, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("marks file tabs outside the workspace as loose", () => {
    const inside = makeFileTab(0); // /path/to/file0.md
    const base = makeFileTab(1);
    const outside: FileTab = {
      ...base,
      file: {
        ...base.file,
        path: "/elsewhere/loose.md",
        metadata: { name: "loose.md", path: "/elsewhere/loose.md", size: 0, modified: 0 },
      },
    };
    renderTabBar({
      tabs: [inside, outside],
      activeTabId: "tab-0",
      workspace: { root: "/path/to", expanded: new Set(), nodes: new Map() },
    });
    const insideEl = screen.getByText("file0.md").closest(".tab-item");
    const outsideEl = screen.getByText("loose.md").closest(".tab-item");
    expect(insideEl?.hasAttribute("data-loose")).toBe(false);
    expect(outsideEl?.getAttribute("data-loose")).toBe("true");
  });

  it("does not mark file tabs as loose when no workspace is open", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", workspace: null });
    expect(screen.getByText("file0.md").closest(".tab-item")?.hasAttribute("data-loose")).toBe(
      false,
    );
  });

  it("shows a dirty dot for tabs with unsaved edits", () => {
    const tab = makeFileTab(0);
    const dirtyTab: FileTab = { ...tab, file: { ...tab.file, dirty: true } };
    const { container } = renderTabBar({ tabs: [dirtyTab], activeTabId: "tab-0" });
    expect(container.querySelector(".tab-dirty-dot")).toBeInTheDocument();
  });

  it("derives the label from the path when a file tab has no metadata (mobile picker)", () => {
    const tab = makeFileTab(0);
    const bare: FileTab = {
      ...tab,
      file: { ...tab.file, path: "file:///On%20My%20iPhone/Picked%20Note.md", metadata: null },
    };
    renderTabBar({ tabs: [bare], activeTabId: "tab-0" });
    expect(screen.getByText("Picked Note.md")).toBeInTheDocument();
  });

  it("falls back to Untitled when a file tab has no metadata and no usable path", () => {
    const tab = makeFileTab(0);
    const bare: FileTab = { ...tab, file: { ...tab.file, path: "", metadata: null } };
    renderTabBar({ tabs: [bare], activeTabId: "tab-0" });
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("labels a root-only graph tab with its raw path", () => {
    renderTabBar({ tabs: [makeGraphTab(0, "/")], activeTabId: "tab-0" });
    expect(screen.getByText("Graph: /")).toBeInTheDocument();
  });

  it("hides the mode toggle when no tab id is active", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: null });
    expect(screen.getByText("file0.md")).toBeInTheDocument();
    expect(screen.queryByLabelText("View mode")).not.toBeInTheDocument();
  });

  it("renders graph tabs with a Graph label and graph kind marker", () => {
    renderTabBar({
      tabs: [makeGraphTab(0, "/Users/me/notes")],
      activeTabId: "tab-0",
    });
    expect(screen.getByText("Graph: notes")).toBeInTheDocument();
    const tabEl = screen.getByText("Graph: notes").closest(".tab-item");
    expect(tabEl?.getAttribute("data-tab-kind")).toBe("graph");
  });

  it("hides the mode toggle when a graph tab is active", () => {
    renderTabBar({
      tabs: [makeGraphTab(0, "/Users/me/notes")],
      activeTabId: "tab-0",
    });
    expect(screen.queryByLabelText("View mode")).not.toBeInTheDocument();
  });

  it("calls setTabMode with the chosen mode from each toggle button", () => {
    const setTabMode = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", setTabMode });

    fireEvent.click(screen.getByRole("button", { name: "View mode" }));
    expect(setTabMode).toHaveBeenCalledWith("tab-0", "view");

    fireEvent.click(screen.getByRole("button", { name: "Edit mode" }));
    expect(setTabMode).toHaveBeenCalledWith("tab-0", "edit");

    fireEvent.click(screen.getByRole("button", { name: "Split mode" }));
    expect(setTabMode).toHaveBeenCalledWith("tab-0", "split");
  });

  it("hides the Split button for canvas files (the board is the editor)", () => {
    const tab = makeFileTab(0);
    const canvasTab: FileTab = {
      ...tab,
      file: { ...tab.file, path: "/path/to/board.canvas" },
    };
    renderTabBar({ tabs: [canvasTab], activeTabId: "tab-0" });
    expect(screen.getByLabelText("View mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit mode")).toBeInTheDocument();
    expect(screen.queryByLabelText("Split mode")).not.toBeInTheDocument();
  });

  it("keeps the Split button for markdown files", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0" });
    expect(screen.getByLabelText("Split mode")).toBeInTheDocument();
  });

  it("hides mode toggle when the active tab is a graph tab", () => {
    renderTabBar({
      tabs: [makeGraphTab(0, "/Users/me/notes")],
      activeTabId: "tab-0",
    });
    expect(screen.queryByLabelText("View mode")).not.toBeInTheDocument();
  });

  describe("context menu", () => {
    const rightClick = (name: string, at = { clientX: 120, clientY: 30 }) => {
      const tabEl = screen.getByText(name).closest(".tab-item") as HTMLElement;
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at });
      fireEvent(tabEl, event);
      return event;
    };

    it("opens the menu at the cursor and suppresses the native one", () => {
      renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-0" });
      const event = rightClick("file1.md");
      expect(event.defaultPrevented).toBe(true);
      const menu = screen.getByRole("menu");
      expect(menu).toHaveStyle({ left: "120px", top: "30px" });
      expect(screen.getByRole("menuitem", { name: "Close Others" })).toBeInTheDocument();
    });

    // The Menu key raises contextmenu with no pointer position (0,0 on WebKit),
    // which would otherwise pin the menu to the viewport corner.
    it("anchors a keyboard-raised menu to the tab", () => {
      renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
      const tabEl = screen.getByText("file0.md").closest(".tab-item") as HTMLElement;
      vi.spyOn(tabEl, "getBoundingClientRect").mockReturnValue({
        left: 8,
        bottom: 34,
      } as DOMRect);

      rightClick("file0.md", { clientX: 0, clientY: 0 });
      expect(screen.getByRole("menu")).toHaveStyle({ left: "8px", top: "34px" });
    });

    // The menu acts on the tab under the cursor, not on the active one.
    it("closes the tabs after the right-clicked tab, not the active tab", () => {
      const closeTabs = vi.fn();
      renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-2", closeTabs });
      rightClick("file0.md");
      fireEvent.click(screen.getByRole("menuitem", { name: "Close to the Right" }));
      expect(closeTabs).toHaveBeenCalledWith(["tab-1", "tab-2"]);
    });

    it("closes the menu after running an action", () => {
      renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
      rightClick("file0.md");
      fireEvent.click(screen.getByRole("menuitem", { name: "Close All" }));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("drops the menu when the right-clicked tab disappears under it", () => {
      const { rerender, value } = renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
      rightClick("file1.md");
      expect(screen.getByRole("menu")).toBeInTheDocument();

      rerender(
        <Wrapper value={{ ...value, tabs: [makeFileTab(0)] }} sidebar={sidebarLayoutValue()}>
          <TabBar onToggleAIChat={null} onOpenPalette={vi.fn()} />
        </Wrapper>,
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes the menu on Escape", () => {
      renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
      rightClick("file0.md");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
