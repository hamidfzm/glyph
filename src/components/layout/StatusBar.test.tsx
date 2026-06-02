import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { FileTab } from "@/hooks/useTabs";
import { DEFAULT_SETTINGS } from "@/lib/settings";
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
      <StatusBar />
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
