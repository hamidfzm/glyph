import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TocEntry } from "../../hooks/useTableOfContents";
import type { FileTab, FolderTab, Tab } from "../../hooks/useTabs";
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

function defaultProps(
  overrides: Partial<ComponentProps<typeof Sidebar>> = {},
): ComponentProps<typeof Sidebar> {
  return {
    side: "left",
    activeTab: makeFileTab(),
    tocEntries: mockEntries,
    filesVisible: true,
    outlineVisible: true,
    sidebarLayout: "split",
    swapSidebarSides: false,
    onToggleFiles: vi.fn(),
    onToggleOutline: vi.fn(),
    onToggleExpand: vi.fn(),
    onOpenFileInTab: vi.fn(),
    onOpenFileInNewTab: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props = defaultProps(overrides);
  return { ...render(<Sidebar {...props} />), props };
}

// Render both sides at once to test the full layout (matches App.tsx).
function renderBothSides(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const left = defaultProps({ ...overrides, side: "left" });
  const right = defaultProps({ ...overrides, side: "right" });
  const result = render(
    <>
      <Sidebar {...left} />
      <Sidebar {...right} />
    </>,
  );
  return { ...result, props: left };
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
    const { container, props } = renderSidebar({ outlineVisible: false });
    const edge = container.querySelector('[data-sidebar-edge="left"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(props.onToggleOutline).toHaveBeenCalledOnce();
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
    const { container, props } = renderSidebar({ activeTab: tab, filesVisible: false });
    const edge = container.querySelector('[data-sidebar-edge="left"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(props.onToggleFiles).toHaveBeenCalledOnce();
  });

  it("shows edge expand handle on the right when outline panel is hidden (folder split)", () => {
    const tab: Tab = makeFolderTab();
    const { container, props } = renderSidebar({
      activeTab: tab,
      side: "right",
      outlineVisible: false,
    });
    const edge = container.querySelector('[data-sidebar-edge="right"]');
    expect(edge).toBeInTheDocument();
    fireEvent.click(edge as Element);
    expect(props.onToggleOutline).toHaveBeenCalledOnce();
  });

  it("renders Files + Outline combined when combineSidebars=true", () => {
    const tab: Tab = makeFolderTab();
    const { container } = renderBothSides({ activeTab: tab, sidebarLayout: "combined" });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(container.querySelectorAll("nav").length).toBe(1);
  });

  it("renders Files left + Outline right when combineSidebars=false (folder tab)", () => {
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
    // Files now on the right; Outline now on the left
    const rightNav = container.querySelector('nav[data-sidebar="right"]');
    const leftNav = container.querySelector('nav[data-sidebar="left"]');
    expect(rightNav?.textContent).toContain("readme.md");
    expect(leftNav?.textContent).toContain("Outline");
  });
});
