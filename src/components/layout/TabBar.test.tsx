import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { activeFileOf, type FileTab, type FolderTab, type Tab } from "@/hooks/useTabs";
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
  },
});

const makeFolderTab = (i: number, root: string): FolderTab => ({
  id: `tab-${i}`,
  kind: "folder",
  root,
  expanded: new Set(),
  nodes: new Map(),
  file: null,
});

const makeTabs = (count: number): Tab[] => Array.from({ length: count }, (_, i) => makeFileTab(i));

interface RenderOpts {
  tabs?: Tab[];
  activeTabId?: string | null;
  setActiveTab?: (id: string) => void;
  closeTab?: (id: string) => void;
  setTabMode?: TabsContextValue["setTabMode"];
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
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openFileInFolderTab: vi.fn(),
    toggleExpand: vi.fn(),
    closeTab: opts.closeTab ?? vi.fn(),
    setActiveTab: opts.setActiveTab ?? vi.fn(),
    setTabMode: opts.setTabMode ?? vi.fn(),
    updateEditContent: vi.fn(),
    markSaved: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: [],
    backlinks: [],
  };
}

function Wrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

function renderTabBar(opts: RenderOpts = {}) {
  const value = buildContext(opts);
  return {
    ...render(
      <Wrapper value={value}>
        <TabBar />
      </Wrapper>,
    ),
    value,
  };
}

describe("TabBar", () => {
  it("renders nothing when no tabs", () => {
    const { container } = renderTabBar({ tabs: [] });
    expect(container.firstChild).toBeNull();
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

  it("renders folder tabs with the folder basename and folder kind marker", () => {
    renderTabBar({
      tabs: [makeFolderTab(0, "/Users/me/notes")],
      activeTabId: "tab-0",
    });
    expect(screen.getByText("notes")).toBeInTheDocument();
    const tabEl = screen.getByText("notes").closest(".tab-item");
    expect(tabEl?.getAttribute("data-tab-kind")).toBe("folder");
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

  it("hides mode toggle when active tab is a folder with no current file", () => {
    renderTabBar({
      tabs: [makeFolderTab(0, "/Users/me/notes")],
      activeTabId: "tab-0",
    });
    expect(screen.queryByLabelText("View mode")).not.toBeInTheDocument();
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
});
