import { invoke } from "@tauri-apps/api/core";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigProvider } from "@/contexts/SyncConfigProvider";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useZoomApi } from "@/contexts/ZoomContext";
import { ZoomProvider } from "@/contexts/ZoomProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { FileTab, Workspace } from "@/lib/tabs";
import { tabsContextValue } from "@/test/fixtures/tabsContext";
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
  return tabsContextValue({
    tabs: activeTab ? [activeTab] : [],
    activeTab,
    activeTabId: activeTab?.id ?? null,
    activeFile: activeTab?.file ?? null,
    displayContent: opts.displayContent ?? null,
  });
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

function zoomFontSizeTo(fontSize: number) {
  settingsRef.current = {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, fontSize },
  };
}

describe("StatusBar", () => {
  it("renders nothing when no tab is active", () => {
    const { container } = renderStatusBar();
    expect(container.firstChild).toBeNull();
  });

  it("renders the file path, word count, and reading time for a note", () => {
    renderStatusBar({ filePath: "/path/to/note.md", displayContent: "hello world test" });
    expect(screen.getByText("/path/to/note.md")).toBeInTheDocument();
    expect(screen.getByText("3 words")).toBeInTheDocument();
    expect(screen.getByText("1 min read")).toBeInTheDocument();
  });

  it("does not show zoom percentage at default zoom (100%)", () => {
    renderStatusBar({ filePath: "/a.md", displayContent: "some content" });
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("shows the zoom percentage when font size differs from default", () => {
    zoomFontSizeTo(20);
    renderStatusBar({ filePath: "/a.md", displayContent: "some content" });
    // 20 / 16 = 125%
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("scales the zoom percentage by the active tab's temporary multiplier", () => {
    const value = buildContext({ filePath: "/a.md", displayContent: "some content" });
    function Bump() {
      const api = useZoomApi();
      return (
        <button type="button" onClick={() => api?.setNoteZoom("tab-1", () => 1.5)}>
          bump
        </button>
      );
    }
    render(
      <Wrapper value={value}>
        <ZoomProvider>
          <StatusBar onOpenSync={vi.fn()} />
          <Bump />
        </ZoomProvider>
      </Wrapper>,
    );
    act(() => screen.getByText("bump").click());
    // 16 / 16 * 1.5 = 150%
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("keeps the bar for a canvas without text stats or font zoom", () => {
    // A canvas has displayContent (its projected card text), unlike notebooks.
    zoomFontSizeTo(20);
    renderStatusBar({ filePath: "/path/to/board.canvas", displayContent: "hello world test" });
    expect(screen.getByText("/path/to/board.canvas")).toBeInTheDocument();
    expect(screen.queryByText(/words?$/)).toBeNull();
    expect(screen.queryByText(/min read$/)).toBeNull();
    expect(screen.queryByText("125%")).toBeNull();
  });

  it("keeps the bar for a notebook without text stats", () => {
    renderStatusBar({ filePath: "/path/to/analysis.ipynb", displayContent: null });
    expect(screen.getByText("/path/to/analysis.ipynb")).toBeInTheDocument();
    expect(screen.queryByText(/words?$/)).toBeNull();
  });

  it("shows stats and zoom for an empty note", () => {
    zoomFontSizeTo(20);
    renderStatusBar({ filePath: "/path/to/Untitled-1", displayContent: "" });
    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("125%")).toBeInTheDocument();
  });
});

function makeWorkspace(root = "/ws"): Workspace {
  return { root, expanded: new Set<string>(), nodes: new Map() };
}

function buildWorkspaceContext(): TabsContextValue {
  return tabsContextValue({
    workspace: makeWorkspace(),
    activeTabId: "tab-1",
    displayContent: "some content",
  });
}

describe("StatusBar sync indicator gating", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // SyncStatusIndicator's useSyncConfig fires sync_get_config on mount;
    // resolve to null so it renders the "Sync off" pill cleanly.
    vi.mocked(invoke).mockResolvedValue(null as unknown as never);
  });

  it("does not render the sync pill when onOpenSync is null", async () => {
    const value = buildWorkspaceContext();
    render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={null} />
      </Wrapper>,
    );
    // SyncConfigProvider fetches sync_get_config on mount; let it settle so
    // its state updates land inside act before asserting.
    await act(async () => {});
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

  it("keeps the bar and sync pill on a graph tab, which has no file", async () => {
    const value = tabsContextValue({ workspace: makeWorkspace(), activeTabId: "graph-1" });
    const { container } = render(
      <Wrapper value={value}>
        <StatusBar onOpenSync={vi.fn()} />
      </Wrapper>,
    );
    expect(await screen.findByText("Sync off")).toBeInTheDocument();
    expect(container.querySelector(".status-bar-path")).toBeNull();
    expect(screen.queryByText(/min read$/)).toBeNull();
  });
});
