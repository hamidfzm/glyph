import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MetadataIndex } from "@/lib/metadata";
import { SIDEBAR_WIDTH_DEFAULT } from "@/lib/settings";
import { makeWorkspace, renderBothSides, renderSidebar } from "@/test/fixtures/sidebar";

vi.mock("@/lib/pickers", () => ({
  pickMoveDir: vi.fn(),
}));

// One tagged note, enough for the Files panel to render the tag cloud.
function taggedIndex(): MetadataIndex {
  return new Map([["/tmp/notes/readme.md", { tags: ["notes"], fields: new Map() }]]);
}

describe("Sidebar placement", () => {
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

  // Split layout, outline side, nothing to outline: the panel and its edge
  // handle both stay away rather than leaving an empty rail.
  it("renders nothing on the outline side of a workspace with no headings", () => {
    const { container } = renderSidebar({
      side: "right",
      activeTab: null,
      workspace: makeWorkspace(),
      tocEntries: [],
    });
    expect(container).toBeEmptyDOMElement();
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

  // Combined mode has one panel, so hiding both halves must leave the edge
  // handle rather than an empty panel taking up its width.
  it("renders only the edge handle when combined has both halves hidden", () => {
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
      sidebarLayout: "combined",
      filesVisible: false,
      outlineVisible: false,
    });
    expect(container.querySelector("nav")).not.toBeInTheDocument();
    expect(container.querySelector('[data-sidebar-edge="left"]')).toBeInTheDocument();
  });

  it("renders the outline alone when combined has the files half hidden", () => {
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
      sidebarLayout: "combined",
      filesVisible: false,
    });
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(container.querySelectorAll("nav").length).toBe(1);
  });

  it("keeps the outline panel beside the files edge handle when files are hidden", () => {
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
      sidebarLayout: "beside",
      filesVisible: false,
    });
    expect(container.querySelector('[data-sidebar-edge="left"]')).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
  });

  it("offers an outline edge handle beside the files panel when the outline is hidden", () => {
    const { container } = renderBothSides({
      workspace: makeWorkspace(),
      sidebarLayout: "beside",
      outlineVisible: false,
    });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(container.querySelector('[data-sidebar-edge="left"]')).toBeInTheDocument();
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

  it("drags the tags divider and persists the height", () => {
    const setTagsHeight = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), setTagsHeight, tabs: { metadata: taggedIndex() } });
    const handle = screen.getByRole("separator", { name: "Resize tags" });
    const block = handle.nextElementSibling as HTMLElement;
    Object.defineProperty(block, "offsetHeight", { configurable: true, value: 100 });
    Object.defineProperty(block.parentElement as HTMLElement, "clientHeight", {
      configurable: true,
      value: 500,
    });
    fireEvent.pointerDown(handle, { button: 0, clientY: 400 });
    // The block sits below the tree: dragging the divider up grows it.
    fireEvent.pointerMove(handle, { clientY: 360 });
    expect(block.style.height).toBe("140px");
    fireEvent.pointerUp(handle);
    expect(setTagsHeight).toHaveBeenCalledExactlyOnceWith(140);
  });

  it("applies a persisted tags height when idle", () => {
    renderSidebar({
      workspace: makeWorkspace(),
      tagsHeight: 120,
      tabs: { metadata: taggedIndex() },
    });
    const handle = screen.getByRole("separator", { name: "Resize tags" });
    expect((handle.nextElementSibling as HTMLElement).style.height).toBe("120px");
    expect(handle).toHaveAttribute("aria-valuenow", "120");
  });

  it("double-click on the tags divider restores the automatic height", () => {
    const setTagsHeight = vi.fn();
    renderSidebar({ workspace: makeWorkspace(), setTagsHeight, tabs: { metadata: taggedIndex() } });
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize tags" }));
    expect(setTagsHeight).toHaveBeenCalledExactlyOnceWith(null);
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
});
