import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigProvider } from "@/contexts/SyncConfigProvider";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { FileTab, Workspace } from "@/hooks/useTabs";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
import { StatusBar } from "./StatusBar";

// useSettings is read for the zoom indicator. Mock it so a test can drive a
// non-default font size; default to DEFAULT_SETTINGS otherwise.
const settingsRef = { current: DEFAULT_SETTINGS };
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settingsRef.current, updateSettings: vi.fn() }),
}));

afterEach(() => {
  settingsRef.current = DEFAULT_SETTINGS;
});

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
      virtual: false,
      revision: 0,
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
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: null,
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
    displayContent: opts.displayContent ?? null,
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
  };
}

function Wrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  // StatusBar renders the sync pill, which reads from SyncConfigContext.
  return (
    <TabsContext.Provider value={value}>
      <SyncConfigProvider>{children}</SyncConfigProvider>
    </TabsContext.Provider>
  );
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

  it("shows the zoom percentage when font size differs from default", () => {
    settingsRef.current = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 20 },
    };
    renderStatusBar({ displayContent: "some content" });
    // 20 / 16 = 125%
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("shows a Jupyter Notebook label (not word count) for an .ipynb file", () => {
    // Notebooks suppress displayContent, so the bar still renders via the
    // isNotebook path and shows the document-type label instead of word count.
    renderStatusBar({ filePath: "/path/to/analysis.ipynb", displayContent: null });
    expect(screen.getByText("Jupyter Notebook")).toBeInTheDocument();
    expect(screen.queryByText(/words$/)).toBeNull();
    expect(screen.getByText("/path/to/analysis.ipynb")).toBeInTheDocument();
  });
});

function makeWorkspace(root = "/ws"): Workspace {
  return { root, expanded: new Set<string>(), nodes: new Map() };
}

function buildWorkspaceContext(): TabsContextValue {
  return {
    tabs: [],
    activeTab: null,
    activeTabId: null,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: makeWorkspace(),
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
    displayContent: "some content",
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
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
    const value = buildWorkspaceContext();
    render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={null} />
      </Wrapper>,
    );
    expect(screen.queryByText(/Sync/)).toBeNull();
  });

  it("renders the sync pill when onOpenSync is provided and a workspace is open", async () => {
    const value = buildWorkspaceContext();
    render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={vi.fn()} />
      </Wrapper>,
    );
    expect(await screen.findByText("Sync off")).toBeInTheDocument();
  });
});
