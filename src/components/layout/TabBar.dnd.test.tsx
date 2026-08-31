import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { activeFileOf, type FileTab, type Tab } from "@/lib/tabs";
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
    flushSessionForClose: vi.fn(async () => {}),
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

describe("drag-and-drop reordering", () => {
  const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });
  const tabEl = (name: string) => screen.getByText(name).closest(".tab-item") as HTMLElement;

  it("marks every tab as draggable", () => {
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
    expect(tabEl("file0.md").getAttribute("draggable")).toBe("true");
    expect(tabEl("file1.md").getAttribute("draggable")).toBe("true");
  });

  it("moves the dragged tab to the drop target's index", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-0", moveTab });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file0.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file2.md"), { dataTransfer: dt });
    fireEvent.drop(tabEl("file2.md"), { dataTransfer: dt });
    expect(moveTab).toHaveBeenCalledWith("tab-0", 2);
  });

  it("shows the drop indicator on the trailing edge when dragging right", () => {
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-0" });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file0.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file2.md"), { dataTransfer: dt });
    // dragover fires repeatedly over the same target; the indicator is stable.
    fireEvent.dragOver(tabEl("file2.md"), { dataTransfer: dt });
    expect(tabEl("file2.md").getAttribute("data-drop")).toBe("after");
  });

  it("shows the drop indicator on the leading edge when dragging left", () => {
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-2" });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file2.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file0.md"), { dataTransfer: dt });
    expect(tabEl("file0.md").getAttribute("data-drop")).toBe("before");
  });

  it("shows no indicator over the dragged tab itself and does not move on self-drop", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0", moveTab });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file0.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file1.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file0.md"), { dataTransfer: dt });
    expect(tabEl("file0.md").hasAttribute("data-drop")).toBe(false);
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    fireEvent.drop(tabEl("file0.md"), { dataTransfer: dt });
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("clears the indicator when the drag ends without a drop", () => {
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file0.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file1.md"), { dataTransfer: dt });
    expect(tabEl("file1.md").getAttribute("data-drop")).toBe("after");
    fireEvent.dragEnd(tabEl("file0.md"), { dataTransfer: dt });
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
  });

  it("ignores dragover and drop when no tab drag is in progress", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0", moveTab });
    const dt = dataTransfer();
    fireEvent.dragOver(tabEl("file1.md"), { dataTransfer: dt });
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    fireEvent.drop(tabEl("file1.md"), { dataTransfer: dt });
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("clears the indicator after a completed drop", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-0", moveTab });
    const dt = dataTransfer();
    fireEvent.dragStart(tabEl("file0.md"), { dataTransfer: dt });
    fireEvent.dragOver(tabEl("file1.md"), { dataTransfer: dt });
    fireEvent.drop(tabEl("file1.md"), { dataTransfer: dt });
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
  });
});

// Regression: <button> cannot be a descendant of <button> per the HTML
// spec, and React 19 logs a hydration error when it sees it. The close
// button used to sit inside the tab activate button; now it's a sibling.
it("does not nest a button inside another button", () => {
  const { container } = renderTabBar({ tabs: makeTabs(2), activeTabId: "tab-0" });
  for (const button of container.querySelectorAll("button")) {
    expect(button.querySelector("button")).toBeNull();
  }
});
