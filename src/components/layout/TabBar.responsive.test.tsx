import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("TabBar on mobile", () => {
  const heading = [{ id: "h1", text: "Heading", level: 1 }];

  beforeEach(async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
  });

  afterEach(async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("macos");
  });

  // Mobile has no native menu or keyboard shortcut, so the tab bar is the only
  // way to open another file once a tab is showing.
  it("offers Open File and runs the picker", () => {
    const openFileDialog = vi.fn();
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", openFileDialog });
    fireEvent.click(screen.getByRole("button", { name: "Open File" }));
    expect(openFileDialog).toHaveBeenCalled();
  });

  it("keeps Open File off the desktop tab bar", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("macos");
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0" });
    expect(screen.queryByRole("button", { name: "Open File" })).not.toBeInTheDocument();
  });

  it("toggles the outline drawer from the tab bar", () => {
    const toggleOutline = vi.fn();
    renderTabBar({
      tabs: makeTabs(1),
      activeTabId: "tab-0",
      tocEntries: heading,
      sidebar: { outlineVisible: false, toggleOutline },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show outline sidebar" }));
    expect(toggleOutline).toHaveBeenCalled();
  });

  it("labels the outline button as hide while the drawer is open", () => {
    renderTabBar({
      tabs: makeTabs(1),
      activeTabId: "tab-0",
      tocEntries: heading,
      sidebar: { outlineVisible: true },
    });
    expect(screen.getByRole("button", { name: "Hide outline sidebar" })).toBeInTheDocument();
  });

  it("hides the outline button for a document with no headings", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0", tocEntries: [] });
    expect(screen.queryByRole("button", { name: /outline sidebar/ })).not.toBeInTheDocument();
  });
});

describe("TabBar on a viewport too small to split", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("hides the Split button", () => {
    renderTabBar({ tabs: makeTabs(1), activeTabId: "tab-0" });
    expect(screen.queryByLabelText("Split mode")).not.toBeInTheDocument();
    expect(screen.getByLabelText("View mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit mode")).toBeInTheDocument();
  });

  // A tab persisted as split from a desktop session renders as the read-only
  // view here, so View is the button that reads as active.
  it("marks View active for a tab stored as split", () => {
    const splitTab = makeFileTab(0);
    splitTab.file.mode = "split";
    renderTabBar({ tabs: [splitTab], activeTabId: "tab-0" });
    expect(screen.getByLabelText("View mode")).toHaveAttribute("data-active", "true");
  });
});
