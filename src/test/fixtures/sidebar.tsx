import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { SidebarLayout } from "@/lib/settings";
import type { FileTab, Tab, Workspace } from "@/lib/tabs";
import { sidebarLayoutValue } from "./sidebarLayout";
import { tabsContextValue } from "./tabsContext";

// Shared setup for the Sidebar suites: the tab/workspace fixtures plus the two
// contexts the sidebar reads, wired into render helpers.

export const mockEntries: TocEntry[] = [
  { id: "intro", text: "Introduction", level: 1 },
  { id: "details", text: "Details", level: 2 },
];

export function makeFileTab(): FileTab {
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

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
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

export interface RenderOpts {
  side?: "left" | "right";
  activeTab?: Tab | null;
  workspace?: Workspace | null;
  tocEntries?: TocEntry[];
  filesVisible?: boolean;
  outlineVisible?: boolean;
  compact?: boolean;
  closeCompactPanels?: () => void;
  sidebarLayout?: SidebarLayout;
  swapSidebarSides?: boolean;
  toggleFiles?: () => void;
  toggleOutline?: () => void;
  setFilesSidebarWidth?: (width: number) => void;
  setOutlineSidebarWidth?: (width: number) => void;
  setBacklinksHeight?: (height: number | null) => void;
  backlinksHeight?: number | null;
  setTagsHeight?: (height: number | null) => void;
  tagsHeight?: number | null;
  backlinksCollapsed?: boolean;
  tagsCollapsed?: boolean;
  setBacklinksCollapsed?: (collapsed: boolean) => void;
  setTagsCollapsed?: (collapsed: boolean) => void;
  tabs?: Partial<TabsContextValue>;
}

function buildTabsContext(opts: RenderOpts): TabsContextValue {
  return tabsContextValue({
    tabs: opts.activeTab ? [opts.activeTab] : [],
    activeTab: opts.activeTab ?? null,
    activeTabId: opts.activeTab?.id ?? null,
    activeFile: opts.activeTab?.file ?? null,
    workspace: opts.workspace ?? null,
    tocEntries: opts.tocEntries ?? mockEntries,
    ...opts.tabs,
  });
}

function buildSidebarContext(opts: RenderOpts): SidebarLayoutContextValue {
  return sidebarLayoutValue({
    filesVisible: opts.filesVisible ?? true,
    outlineVisible: opts.outlineVisible ?? true,
    compact: opts.compact ?? false,
    closeCompactPanels: opts.closeCompactPanels ?? vi.fn(),
    toggleFiles: opts.toggleFiles ?? vi.fn(),
    toggleOutline: opts.toggleOutline ?? vi.fn(),
    sidebarLayout: opts.sidebarLayout ?? "split",
    swapSidebarSides: opts.swapSidebarSides ?? false,
    backlinksHeight: opts.backlinksHeight ?? null,
    tagsHeight: opts.tagsHeight ?? null,
    setFilesSidebarWidth: opts.setFilesSidebarWidth ?? vi.fn(),
    setOutlineSidebarWidth: opts.setOutlineSidebarWidth ?? vi.fn(),
    setBacklinksHeight: opts.setBacklinksHeight ?? vi.fn(),
    setTagsHeight: opts.setTagsHeight ?? vi.fn(),
    backlinksCollapsed: opts.backlinksCollapsed ?? false,
    tagsCollapsed: opts.tagsCollapsed ?? false,
    setBacklinksCollapsed: opts.setBacklinksCollapsed ?? vi.fn(),
    setTagsCollapsed: opts.setTagsCollapsed ?? vi.fn(),
  });
}

export function Wrapper({ opts, children }: { opts: RenderOpts; children: ReactNode }) {
  const tabs = buildTabsContext(opts);
  const sidebar = buildSidebarContext(opts);
  return (
    <TabsContext.Provider value={tabs}>
      <SidebarLayoutContext.Provider value={sidebar}>{children}</SidebarLayoutContext.Provider>
    </TabsContext.Provider>
  );
}

export function renderSidebar(opts: RenderOpts = {}) {
  const fullOpts = { activeTab: makeFileTab(), ...opts };
  const result = render(
    <Wrapper opts={fullOpts}>
      <Sidebar side={fullOpts.side ?? "left"} />
    </Wrapper>,
  );
  return { ...result, opts: fullOpts };
}

export function renderBothSides(opts: RenderOpts = {}) {
  const fullOpts = { activeTab: makeFileTab(), ...opts };
  const result = render(
    <Wrapper opts={fullOpts}>
      <Sidebar side="left" />
      <Sidebar side="right" />
    </Wrapper>,
  );
  return { ...result, opts: fullOpts };
}
