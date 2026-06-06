import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { FileTab, FolderTab, Tab } from "@/hooks/useTabs";
import type { SidebarLayout } from "@/lib/settings";
import { Sidebar } from "./Sidebar";

const mockEntries: TocEntry[] = [
  { id: "intro", text: "Introduction", level: 1 },
  { id: "details", text: "Details", level: 2 },
];

function makeFileTab(): FileTab {
  return {
    id: "tab-1",
    kind: "file",
    file: {
      path: "/tmp/post.md",
      content: "# Post",
      metadata: { name: "post.md", path: "/tmp/post.md", size: 1, modified: 0 },
      scrollTop: 0,
      mode: "view",
      editContent: null,
      dirty: false,
    },
  };
}

function makeFolderTab(overrides: Partial<FolderTab> = {}): FolderTab {
  return {
    id: "tab-2",
    kind: "folder",
    root: "/tmp/notes",
    expanded: new Set(),
    nodes: new Map([
      [
        "/tmp/notes",
        [{ name: "readme.md", path: "/tmp/notes/readme.md", isDirectory: false, modified: 0 }],
      ],
    ]),
    file: null,
    ...overrides,
  };
}

interface RenderOpts {
  side?: "left" | "right";
  activeTab?: Tab | null;
  tocEntries?: TocEntry[];
  filesVisible?: boolean;
  outlineVisible?: boolean;
  sidebarLayout?: SidebarLayout;
  swapSidebarSides?: boolean;
  toggleFiles?: () => void;
  toggleOutline?: () => void;
  tabs?: Partial<TabsContextValue>;
}

function buildTabsContext(opts: RenderOpts): TabsContextValue {
  return {
    tabs: opts.activeTab ? [opts.activeTab] : [],
    activeTab: opts.activeTab ?? null,
    activeTabId: opts.activeTab?.id ?? null,
    activeFile: opts.activeTab
      ? opts.activeTab.kind === "file"
        ? opts.activeTab.file
        : opts.activeTab.file
      : null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openFileInFolderTab: vi.fn(),
    toggleExpand: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    duplicatePath: vi.fn(),
    movePath: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    deletePath: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setTabMode: vi.fn(),
    updateEditContent: vi.fn(),
    markSaved: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: opts.tocEntries ?? mockEntries,
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
    ...opts.tabs,
  };
}

function buildSidebarContext(opts: RenderOpts): SidebarLayoutContextValue {
  return {
    filesVisible: opts.filesVisible ?? true,
    outlineVisible: opts.outlineVisible ?? true,
    toggleFiles: opts.toggleFiles ?? vi.fn(),
    toggleOutline: opts.toggleOutline ?? vi.fn(),
    resetLayout: vi.fn(),
    sidebarLayout: opts.sidebarLayout ?? "split",
    swapSidebarSides: opts.swapSidebarSides ?? false,
    sidebarWidth: undefined,
  };
}

function Wrapper({ opts, children }: { opts: RenderOpts; children: ReactNode }) {
  const tabs = buildTabsContext(opts);
  const sidebar = buildSidebarContext(opts);
  return (
    <TabsContext.Provider value={tabs}>
      <SidebarLayoutContext.Provider value={sidebar}>{children}</SidebarLayoutContext.Provider>
    </TabsContext.Provider>
  );
}

function renderSidebar(opts: RenderOpts = {}) {
  const fullOpts = { activeTab: makeFileTab(), ...opts };
  const result = render(
    <Wrapper opts={fullOpts}>
      <Sidebar side={fullOpts.side ?? "left"} />
    </Wrapper>,
  );
  return { ...result, opts: fullOpts };
}

function renderBothSides(opts: RenderOpts = {}) {
  const fullOpts = { activeTab: makeFileTab(), ...opts };
  const result = render(
    <Wrapper opts={fullOpts}>
      <Sidebar side="left" />
      <Sidebar side="right" />
    </Wrapper>,
  );
  return { ...result, opts: fullOpts };
}

describe("Sidebar", () => {
  it("renders nothing when no active tab", () => {
    const { container } = renderSidebar({ activeTab: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a file tab when there are no headings", () => {
    const { container } = renderSidebar({ tocEntries: [] });
    expect(container.firstChild).toBeNull();
  });

  it("renders Outline only for a file tab with headings", () => {
    renderSidebar();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
  });

  it("shows an edge expand handle when outline is hidden but headings exist (file tab)", () => {
    const toggleOutline = vi.fn();
    const { container } = renderSidebar({ outlineVisible: false, toggleOutline });
    const edge = container.querySelector('[data-sidebar-edge="left"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(toggleOutline).toHaveBeenCalledOnce();
  });

  it("renders nothing on a file tab when outline is hidden AND no headings", () => {
    const { container } = renderSidebar({ outlineVisible: false, tocEntries: [] });
    expect(container.firstChild).toBeNull();
  });

  it("renders Files for a folder tab even with no headings", () => {
    const tab: Tab = makeFolderTab();
    renderSidebar({ activeTab: tab, tocEntries: [] });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.queryByText("Outline")).not.toBeInTheDocument();
  });

  it("shows edge expand handle on the left when files panel is hidden (folder tab)", () => {
    const tab: Tab = makeFolderTab();
    const toggleFiles = vi.fn();
    const { container } = renderSidebar({ activeTab: tab, filesVisible: false, toggleFiles });
    const edge = container.querySelector('[data-sidebar-edge="left"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(toggleFiles).toHaveBeenCalledOnce();
  });

  it("shows edge expand handle on the right when outline panel is hidden (folder split)", () => {
    const tab: Tab = makeFolderTab();
    const toggleOutline = vi.fn();
    const { container } = renderSidebar({
      activeTab: tab,
      side: "right",
      outlineVisible: false,
      toggleOutline,
    });
    const edge = container.querySelector('[data-sidebar-edge="right"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(toggleOutline).toHaveBeenCalledOnce();
  });

  it("renders Files + Outline combined when sidebarLayout='combined'", () => {
    const tab: Tab = makeFolderTab();
    const { container } = renderBothSides({ activeTab: tab, sidebarLayout: "combined" });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(container.querySelectorAll("nav").length).toBe(1);
  });

  it("renders Files left + Outline right when sidebarLayout='split' (folder tab)", () => {
    const tab: Tab = makeFolderTab();
    const { container } = renderBothSides({ activeTab: tab, sidebarLayout: "split" });
    expect(container.querySelector('nav[data-sidebar="left"]')).toBeInTheDocument();
    expect(container.querySelector('nav[data-sidebar="right"]')).toBeInTheDocument();
  });

  it("swaps sides when swapSidebarSides=true (file tab outline goes right)", () => {
    const { container } = renderBothSides({ swapSidebarSides: true });
    expect(container.querySelector('nav[data-sidebar="right"]')).toBeInTheDocument();
    expect(container.querySelector('nav[data-sidebar="left"]')).not.toBeInTheDocument();
  });

  it("swaps Files and Outline sides when swapSidebarSides=true (folder split)", () => {
    const tab: Tab = makeFolderTab();
    const { container } = renderBothSides({
      activeTab: tab,
      sidebarLayout: "split",
      swapSidebarSides: true,
    });
    const rightNav = container.querySelector('nav[data-sidebar="right"]');
    const leftNav = container.querySelector('nav[data-sidebar="left"]');
    expect(rightNav?.textContent).toContain("readme.md");
    expect(leftNav?.textContent).toContain("Outline");
  });

  it("file toolbar creates at the root and collapses all when expanded", async () => {
    const createNote = vi.fn();
    const createFolder = vi.fn();
    const collapseAll = vi.fn();
    renderSidebar({
      activeTab: makeFolderTab({ expanded: new Set(["/tmp/notes/sub"]) }),
      tabs: { createNote, createFolder, collapseAll },
    });

    fireEvent.click(screen.getByTitle("New note"));
    await waitFor(() => expect(createNote).toHaveBeenCalledWith("tab-2", "/tmp/notes"));
    fireEvent.click(screen.getByTitle("New folder"));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("tab-2", "/tmp/notes"));

    fireEvent.click(screen.getByTitle("Collapse all"));
    expect(collapseAll).toHaveBeenCalledWith("tab-2");
  });

  it("file toolbar expands all when nothing is expanded", () => {
    const expandAll = vi.fn();
    renderSidebar({ activeTab: makeFolderTab(), tabs: { expandAll } });
    fireEvent.click(screen.getByTitle("Expand all"));
    expect(expandAll).toHaveBeenCalledWith("tab-2");
  });

  it("file menu duplicates, reveals, and moves an entry", async () => {
    vi.mocked(open).mockResolvedValue("/tmp/notes/sub");
    const duplicatePath = vi.fn();
    const movePath = vi.fn();
    renderSidebar({ activeTab: makeFolderTab(), tabs: { duplicatePath, movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Make a copy"));
    expect(duplicatePath).toHaveBeenCalledWith("tab-2", "/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Show in system explorer"));
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() =>
      expect(movePath).toHaveBeenCalledWith("tab-2", "/tmp/notes/readme.md", "/tmp/notes/sub"),
    );
  });

  it("renames an entry from the file menu", async () => {
    const renamePath = vi.fn();
    renderSidebar({ activeTab: makeFolderTab(), tabs: { renamePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Rename"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(renamePath).toHaveBeenCalledWith("tab-2", "/tmp/notes/readme.md", "renamed"),
    );
  });

  it("deletes an entry from the file menu", async () => {
    const deletePath = vi.fn();
    renderSidebar({ activeTab: makeFolderTab(), tabs: { deletePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(deletePath).toHaveBeenCalledWith("tab-2", "/tmp/notes/readme.md"));
  });

  it("Move to… does nothing when the picker is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const movePath = vi.fn();
    renderSidebar({ activeTab: makeFolderTab(), tabs: { movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(movePath).not.toHaveBeenCalled();
  });
});
