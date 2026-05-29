import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { FileTab, FolderTab } from "@/hooks/useTabs";
import { StatusBar } from "./StatusBar";

interface Opts {
  filePath?: string;
  displayContent?: string | null;
}

function buildFileTab(path: string): FileTab {
  return {
    id: "tab-1",
    kind: "file",
    file: {
      path,
      content: "x",
      metadata: { name: path.split("/").pop() ?? path, path, size: 0, modified: 0 },
      scrollTop: 0,
      mode: "view",
      editContent: null,
      dirty: false,
    },
  };
}

function buildContext(opts: Opts): TabsContextValue {
  const activeTab = opts.filePath ? buildFileTab(opts.filePath) : null;
  return {
    tabs: activeTab ? [activeTab] : [],
    activeTab,
    activeTabId: activeTab?.id ?? null,
    activeFile: activeTab?.file ?? null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openFileInFolderTab: vi.fn(),
    toggleExpand: vi.fn(),
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
    displayContent: opts.displayContent ?? null,
    tocEntries: [],
    backlinks: [],
  };
}

function Wrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

function renderStatusBar(opts: Opts = {}) {
  const value = buildContext(opts);
  return render(
    <Wrapper value={value}>
      <StatusBar onOpenSync={vi.fn()} />
    </Wrapper>,
  );
}

describe("StatusBar", () => {
  it("renders nothing when displayContent is null", () => {
    const { container } = renderStatusBar({ displayContent: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when displayContent is undefined", () => {
    const { container } = renderStatusBar();
    expect(container.firstChild).toBeNull();
  });

  it("renders word count and reading time", () => {
    renderStatusBar({ displayContent: "hello world test" });
    expect(screen.getByText("3 words")).toBeInTheDocument();
    expect(screen.getByText("1 min read")).toBeInTheDocument();
  });

  it("displays file path when an active file is present", () => {
    renderStatusBar({ filePath: "/path/to/file.md", displayContent: "some content" });
    expect(screen.getByText("/path/to/file.md")).toBeInTheDocument();
  });

  it("does not display a file path when no active file", () => {
    renderStatusBar({ displayContent: "some content" });
    expect(screen.queryByText(/^\//)).toBeNull();
  });

  it("does not show zoom percentage at default zoom (100%)", () => {
    renderStatusBar({ displayContent: "some content" });
    expect(screen.queryByText("100%")).toBeNull();
  });
});

function buildFolderTab(root = "/ws"): FolderTab {
  return {
    id: "folder-1",
    kind: "folder",
    root,
    expanded: new Set<string>(),
    nodes: new Map(),
    file: null,
  };
}

function buildFolderContext(): TabsContextValue {
  const activeTab = buildFolderTab();
  return {
    tabs: [activeTab],
    activeTab,
    activeTabId: activeTab.id,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openFileInFolderTab: vi.fn(),
    toggleExpand: vi.fn(),
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
    displayContent: "some content",
    tocEntries: [],
    backlinks: [],
  };
}

describe("StatusBar sync indicator gating", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // SyncStatusIndicator's useSyncConfig fires sync_get_config on mount;
    // resolve to null so it renders the "Sync off" pill cleanly.
    vi.mocked(invoke).mockResolvedValue(null as unknown as never);
  });

  it("does not render the sync pill when onOpenSync is null", () => {
    const value = buildFolderContext();
    render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={null} />
      </Wrapper>,
    );
    expect(screen.queryByText(/Sync/)).toBeNull();
  });

  it("renders the sync pill when onOpenSync is provided and a folder tab is active", async () => {
    const value = buildFolderContext();
    render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={vi.fn()} />
      </Wrapper>,
    );
    expect(await screen.findByText("Sync off")).toBeInTheDocument();
  });
});
