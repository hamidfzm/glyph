import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { FileTab, Tab, Workspace } from "@/hooks/useTabs";
import { pickMoveDir } from "@/lib/pickers";
import { SIDEBAR_WIDTH_DEFAULT, type SidebarLayout } from "@/lib/settings";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
import { Sidebar } from "./Sidebar";

vi.mock("@/lib/pickers", () => ({
  pickMoveDir: vi.fn(),
}));

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
      virtual: false,
      revision: 0,
    },
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    root: "/tmp/notes",
    expanded: new Set(),
    nodes: new Map([
      [
        "/tmp/notes",
        [{ name: "readme.md", path: "/tmp/notes/readme.md", isDirectory: false, modified: 0 }],
      ],
    ]),
    ...overrides,
  };
}

interface RenderOpts {
  side?: "left" | "right";
  activeTab?: Tab | null;
  workspace?: Workspace | null;
  tocEntries?: TocEntry[];
  filesVisible?: boolean;
  outlineVisible?: boolean;
  sidebarLayout?: SidebarLayout;
  swapSidebarSides?: boolean;
  toggleFiles?: () => void;
  toggleOutline?: () => void;
  setFilesSidebarWidth?: (width: number) => void;
  setOutlineSidebarWidth?: (width: number) => void;
  setBacklinksHeight?: (height: number | null) => void;
  backlinksHeight?: number | null;
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
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: opts.workspace ?? null,
    newDocument: vi.fn(),
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
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    moveTab: vi.fn(),
    moveActiveTab: vi.fn(),
    setTabMode: vi.fn(),
    updateEditContent: vi.fn(),
    saveDocument: vi.fn(),
    flushForClose: vi.fn(),
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
    filesSidebarWidth: 200,
    outlineSidebarWidth: 260,
    backlinksHeight: opts.backlinksHeight ?? null,
    setFilesSidebarWidth: opts.setFilesSidebarWidth ?? vi.fn(),
    setOutlineSidebarWidth: opts.setOutlineSidebarWidth ?? vi.fn(),
    setBacklinksHeight: opts.setBacklinksHeight ?? vi.fn(),
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
  it("renders nothing when no active tab and no workspace", () => {
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

  it("renders Files for an open workspace even with no headings or tabs", () => {
    renderSidebar({ activeTab: null, workspace: makeWorkspace(), tocEntries: [] });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.queryByText("Outline")).not.toBeInTheDocument();
  });

  it("shows edge expand handle on the left when files panel is hidden (workspace)", () => {
    const toggleFiles = vi.fn();
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
      filesVisible: false,
      toggleFiles,
    });
    const edge = container.querySelector('[data-sidebar-edge="left"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(toggleFiles).toHaveBeenCalledOnce();
  });

  it("shows edge expand handle on the right when outline panel is hidden (workspace split)", () => {
    const toggleOutline = vi.fn();
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
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
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
      sidebarLayout: "combined",
    });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(container.querySelectorAll("nav").length).toBe(1);
  });

  it("renders Files left + Outline right when sidebarLayout='split' (workspace)", () => {
    const { container } = renderBothSides({ workspace: makeWorkspace(), sidebarLayout: "split" });
    expect(container.querySelector('nav[data-sidebar="left"]')).toBeInTheDocument();
    expect(container.querySelector('nav[data-sidebar="right"]')).toBeInTheDocument();
  });

  it("applies independent widths to the Files and Outline panels", () => {
    const { container } = renderBothSides({ workspace: makeWorkspace(), sidebarLayout: "split" });
    const files = container.querySelector('nav[data-sidebar="left"]') as HTMLElement;
    const outline = container.querySelector('nav[data-sidebar="right"]') as HTMLElement;
    expect(files.style.width).toBe("200px");
    expect(outline.style.width).toBe("260px");
  });

  it("renders resize handles on both panels", () => {
    renderBothSides({ workspace: makeWorkspace(), sidebarLayout: "split" });
    expect(screen.getAllByRole("separator").length).toBe(2);
  });

  it("commits a dragged files-panel width once on release", () => {
    const setFilesSidebarWidth = vi.fn();
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
      sidebarLayout: "split",
      setFilesSidebarWidth,
    });
    const nav = container.querySelector('nav[data-sidebar="left"]') as HTMLElement;
    const handle = within(nav).getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientX: 200 });
    // Left-side panel in LTR: dragging right grows it.
    fireEvent.pointerMove(handle, { clientX: 250 });
    expect(nav.style.width).toBe("250px");
    fireEvent.pointerUp(handle);
    expect(setFilesSidebarWidth).toHaveBeenCalledExactlyOnceWith(250);
  });

  it("inverts the files-panel drag direction under RTL", () => {
    document.documentElement.dir = "rtl";
    try {
      const setFilesSidebarWidth = vi.fn();
      const { container } = renderSidebar({
        workspace: makeWorkspace(),
        sidebarLayout: "split",
        setFilesSidebarWidth,
      });
      const nav = container.querySelector('nav[data-sidebar="left"]') as HTMLElement;
      const handle = within(nav).getByRole("separator");
      fireEvent.pointerDown(handle, { button: 0, clientX: 200 });
      // Mirrored layout: dragging left grows the panel.
      fireEvent.pointerMove(handle, { clientX: 150 });
      fireEvent.pointerUp(handle);
      expect(setFilesSidebarWidth).toHaveBeenCalledExactlyOnceWith(250);
    } finally {
      document.documentElement.dir = "";
    }
  });

  it("double-click on a panel handle resets its width to the default", () => {
    const setFilesSidebarWidth = vi.fn();
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
      sidebarLayout: "split",
      setFilesSidebarWidth,
    });
    const nav = container.querySelector('nav[data-sidebar="left"]') as HTMLElement;
    fireEvent.doubleClick(within(nav).getByRole("separator"));
    expect(setFilesSidebarWidth).toHaveBeenCalledExactlyOnceWith(SIDEBAR_WIDTH_DEFAULT);
  });

  it("drags the backlinks divider and persists the height", () => {
    const setBacklinksHeight = vi.fn();
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
      setBacklinksHeight,
      tabs: { backlinks: [{ source: "/tmp/notes/other.md", line: 3, snippet: "see readme" }] },
    });
    const wrapper = container.querySelector(".backlinks-section")?.parentElement as HTMLElement;
    Object.defineProperty(wrapper, "offsetHeight", { configurable: true, value: 150 });
    Object.defineProperty(wrapper.parentElement as HTMLElement, "clientHeight", {
      configurable: true,
      value: 500,
    });
    const handle = screen.getByRole("separator", { name: "Resize backlinks" });
    fireEvent.pointerDown(handle, { button: 0, clientY: 400 });
    // The block sits at the bottom: dragging the divider up grows it.
    fireEvent.pointerMove(handle, { clientY: 350 });
    expect(wrapper.style.height).toBe("200px");
    fireEvent.pointerUp(handle);
    expect(setBacklinksHeight).toHaveBeenCalledExactlyOnceWith(200);
  });

  it("applies a persisted backlinks height when idle", () => {
    const { container } = renderSidebar({
      workspace: makeWorkspace(),
      backlinksHeight: 150,
      tabs: { backlinks: [{ source: "/tmp/notes/other.md", line: 3, snippet: "see readme" }] },
    });
    const wrapper = container.querySelector(".backlinks-section")?.parentElement as HTMLElement;
    expect(wrapper.style.height).toBe("150px");
    const handle = screen.getByRole("separator", { name: "Resize backlinks" });
    expect(handle).toHaveAttribute("aria-valuenow", "150");
  });

  it("double-click on the backlinks divider restores the automatic height", () => {
    const setBacklinksHeight = vi.fn();
    renderSidebar({
      workspace: makeWorkspace(),
      setBacklinksHeight,
      tabs: { backlinks: [{ source: "/tmp/notes/other.md", line: 3, snippet: "see readme" }] },
    });
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize backlinks" }));
    expect(setBacklinksHeight).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("swaps sides when swapSidebarSides=true (file tab outline goes right)", () => {
    const { container } = renderBothSides({ swapSidebarSides: true });
    expect(container.querySelector('nav[data-sidebar="right"]')).toBeInTheDocument();
    expect(container.querySelector('nav[data-sidebar="left"]')).not.toBeInTheDocument();
  });

  it("swaps Files and Outline sides when swapSidebarSides=true (workspace split)", () => {
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
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
      workspace: makeWorkspace({ expanded: new Set(["/tmp/notes/sub"]) }),
      tabs: { createNote, createFolder, collapseAll },
    });

    fireEvent.click(screen.getByTitle("New note"));
    await waitFor(() => expect(createNote).toHaveBeenCalledWith("/tmp/notes"));
    fireEvent.click(screen.getByTitle("New folder"));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("/tmp/notes"));

    fireEvent.click(screen.getByTitle("Collapse all"));
    expect(collapseAll).toHaveBeenCalledOnce();
  });

  it("file toolbar expands all when nothing is expanded", () => {
    const expandAll = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { expandAll } });
    fireEvent.click(screen.getByTitle("Expand all"));
    expect(expandAll).toHaveBeenCalledOnce();
  });

  it("closes the workspace from the files toolbar", () => {
    const closeWorkspace = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { closeWorkspace } });
    fireEvent.click(screen.getByTitle("Close workspace"));
    expect(closeWorkspace).toHaveBeenCalledOnce();
  });

  it("file menu duplicates, reveals, and moves an entry", async () => {
    vi.mocked(pickMoveDir).mockResolvedValue("/tmp/notes/sub");
    const duplicatePath = vi.fn();
    const movePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { duplicatePath, movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Make a copy"));
    expect(duplicatePath).toHaveBeenCalledWith("/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Show in system explorer"));
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/notes/readme.md");

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() =>
      expect(movePath).toHaveBeenCalledWith("/tmp/notes/readme.md", "/tmp/notes/sub"),
    );
  });

  it("creates a canvas in the entry's directory from the file menu", async () => {
    const createCanvas = vi.fn(async () => null);
    renderSidebar({ workspace: makeWorkspace(), tabs: { createCanvas } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("New Canvas"));
    await waitFor(() => expect(createCanvas).toHaveBeenCalledWith("/tmp/notes"));
  });

  it("renames an entry from the file menu", async () => {
    const renamePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { renamePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Rename"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(renamePath).toHaveBeenCalledWith("/tmp/notes/readme.md", "renamed"));
  });

  it("deletes an entry from the file menu", async () => {
    const deletePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { deletePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(deletePath).toHaveBeenCalledWith("/tmp/notes/readme.md"));
  });

  it("Move to… does nothing when the picker is cancelled", async () => {
    vi.mocked(pickMoveDir).mockResolvedValue(null);
    const movePath = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), tabs: { movePath } });

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(screen.getByText("Move to…"));
    await waitFor(() => expect(pickMoveDir).toHaveBeenCalled());
    expect(movePath).not.toHaveBeenCalled();
  });
});
