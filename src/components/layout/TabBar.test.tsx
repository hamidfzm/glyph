import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { activeFileOf, type FileTab, type GraphTab, type Tab } from "@/hooks/useTabs";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
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
  closeTab?: (id: string) => Promise<void>;
  setTabMode?: TabsContextValue["setTabMode"];
  moveTab?: (id: string, toIndex: number) => void;
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
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: opts.workspace ?? null,
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openGraph: vi.fn(),
    closeWorkspace: vi.fn(),
    toggleExpand: vi.fn(),
    createNote: vi.fn(),
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
    setActiveTab: opts.setActiveTab ?? vi.fn(),
    setTabMode: opts.setTabMode ?? vi.fn(),
    moveTab: opts.moveTab ?? vi.fn(),
    moveActiveTab: vi.fn(),
    updateEditContent: vi.fn(),
    saveDocument: vi.fn(),
    flushForClose: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
  };
}

function Wrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

function renderTabBar(opts: RenderOpts = {}, onToggleAIChat: (() => void) | null = null) {
  const value = buildContext(opts);
  return {
    ...render(
      <Wrapper value={value}>
        <TabBar onToggleAIChat={onToggleAIChat} />
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

  it("falls back to Untitled when a file tab has no metadata", () => {
    const tab = makeFileTab(0);
    const bare: FileTab = { ...tab, file: { ...tab.file, metadata: null } };
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
});
