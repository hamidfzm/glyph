import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { FileTab, GraphTab } from "@/hooks/useTabs";
import type { EditorMode } from "@/lib/settings";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
import { TabContent } from "./TabContent";

vi.mock("./editor/lazyEditor", () => ({
  MarkdownEditor: ({ onChange }: { onChange: (s: string) => void }) => (
    <button type="button" data-testid="lazy-editor" onClick={() => onChange("EDITED")}>
      editor
    </button>
  ),
  SplitView: ({
    onChange,
    onOpenWikilink,
  }: {
    onChange: (s: string) => void;
    onOpenWikilink?: (path: string) => void;
  }) => (
    <div data-testid="lazy-split">
      <button type="button" data-testid="split-change" onClick={() => onChange("EDITED")}>
        change
      </button>
      <button
        type="button"
        data-testid="split-wikilink"
        onClick={() => onOpenWikilink?.("/note.md")}
      >
        wikilink
      </button>
    </div>
  ),
}));

vi.mock("./graph/lazyGraph", () => ({
  GraphView: ({
    workspaceFiles,
    onOpenFile,
  }: {
    workspaceFiles: readonly string[];
    onOpenFile: (path: string) => void;
  }) => (
    <div data-testid="graph-view">
      <span data-testid="graph-file-count">{workspaceFiles.length}</span>
      <button type="button" data-testid="graph-node" onClick={() => onOpenFile("/workspace/b.md")}>
        node
      </button>
    </div>
  ),
}));

vi.mock("./markdown/MarkdownViewer", () => ({
  MarkdownViewer: ({ filePath }: { filePath?: string }) => (
    <div data-testid="markdown-viewer">{filePath}</div>
  ),
}));

vi.mock("./markdown/ImageViewer", () => ({
  ImageViewer: ({ filePath }: { filePath?: string }) => (
    <div data-testid="image-viewer">{filePath}</div>
  ),
}));

vi.mock("./canvas/lazyCanvas", () => ({
  CanvasViewer: ({ filePath, content }: { filePath?: string; content: string }) => (
    <div data-testid="canvas-viewer" data-content={content}>
      {filePath}
    </div>
  ),
  CanvasEditor: ({ filePath, onChange }: { filePath?: string; onChange: (s: string) => void }) => (
    <button type="button" data-testid="canvas-editor" onClick={() => onChange("CANVAS")}>
      {filePath}
    </button>
  ),
}));

vi.mock("./notebook/lazyNotebook", () => ({
  NotebookViewer: ({ filePath }: { filePath?: string }) => (
    <div data-testid="notebook-viewer">{filePath}</div>
  ),
  NotebookSource: ({ filePath }: { filePath?: string }) => (
    <div data-testid="notebook-source">{filePath}</div>
  ),
  NotebookSplit: ({ filePath }: { filePath?: string }) => (
    <div data-testid="notebook-split">{filePath}</div>
  ),
}));

function makeNotebookTab(mode: EditorMode = "view"): FileTab {
  return {
    id: "tab-nb",
    kind: "file",
    file: {
      path: "/p/analysis.ipynb",
      content: '{"cells": []}',
      metadata: { name: "analysis.ipynb", path: "/p/analysis.ipynb", size: 0, modified: 0 },
      scrollTop: 0,
      mode,
      editContent: null,
      dirty: false,
      revision: 0,
    },
  };
}

function makeCanvasTab(mode: EditorMode = "view"): FileTab {
  return {
    id: "tab-canvas",
    kind: "file",
    file: {
      path: "/p/board.canvas",
      content: '{"nodes":[],"edges":[]}',
      metadata: { name: "board.canvas", path: "/p/board.canvas", size: 0, modified: 0 },
      scrollTop: 0,
      mode,
      editContent: null,
      dirty: false,
      revision: 0,
    },
  };
}

function makeFileTab(mode: EditorMode = "view"): FileTab {
  return {
    id: "tab-1",
    kind: "file",
    file: {
      path: "/p/file.md",
      content: "# hi",
      metadata: { name: "file.md", path: "/p/file.md", size: 0, modified: 0 },
      scrollTop: 0,
      mode,
      editContent: null,
      dirty: false,
      revision: 0,
    },
  };
}

function makeImageTab(): FileTab {
  return {
    id: "tab-img",
    kind: "file",
    file: {
      path: "/p/diagram.svg",
      // Images carry no text content; the viewer renders from the asset protocol.
      content: null,
      metadata: { name: "diagram.svg", path: "/p/diagram.svg", size: 0, modified: 0 },
      scrollTop: 0,
      mode: "view",
      editContent: null,
      dirty: false,
      revision: 0,
    },
  };
}

function makeGraphTab(root = "/workspace"): GraphTab {
  return { id: "tab-g", kind: "graph", root, file: null };
}

function buildContext(over: Partial<TabsContextValue>): TabsContextValue {
  return {
    tabs: [],
    activeTab: null,
    activeTabId: null,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace: null,
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
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
    ...over,
  };
}

function Wrapper({ value, children }: { value: TabsContextValue; children: ReactNode }) {
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

function renderTabContent(over: Partial<TabsContextValue>, searchOpen = false) {
  const value = buildContext(over);
  const onSearchClose = vi.fn();
  const result = render(
    <Wrapper value={value}>
      <TabContent searchOpen={searchOpen} onSearchClose={onSearchClose} />
    </Wrapper>,
  );
  return { ...result, value, onSearchClose };
}

describe("TabContent", () => {
  it("renders nothing when no active tab", () => {
    const { container } = renderTabContent({ activeTab: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the active file has no content", () => {
    const tab = makeFileTab("view");
    tab.file.content = null;
    const { container } = renderTabContent({
      activeTab: tab,
      activeTabId: tab.id,
      activeFile: tab.file,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the viewer for an empty document (empty string is loaded content, not absence)", () => {
    const tab = makeFileTab("view");
    tab.file.content = "";
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
  });

  it("enters edit mode from an empty document", () => {
    const tab = makeFileTab("edit");
    tab.file.content = "";
    tab.file.editContent = "";
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: tab.id,
      activeFile: tab.file,
    });
    expect(getByTestId("lazy-editor")).toBeInTheDocument();
  });

  it("renders the graph view for a graph tab", () => {
    const graph = makeGraphTab();
    renderTabContent({
      tabs: [graph],
      activeTab: graph,
      activeTabId: graph.id,
      workspaceFiles: ["/workspace/a.md", "/workspace/b.md"],
    });
    expect(screen.getByTestId("graph-view")).toBeInTheDocument();
    expect(screen.getByTestId("graph-file-count")).toHaveTextContent("2");
  });

  it("opens a clicked graph node as a document tab", () => {
    const graph = makeGraphTab();
    const openFile = vi.fn();
    const { getByTestId } = renderTabContent({
      tabs: [graph],
      activeTab: graph,
      activeTabId: graph.id,
      openFile,
    });
    getByTestId("graph-node").click();
    expect(openFile).toHaveBeenCalledWith("/workspace/b.md");
  });

  it("renders MarkdownViewer in view mode", () => {
    const tab = makeFileTab("view");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("markdown-viewer")).toHaveTextContent("/p/file.md");
  });

  it("renders MarkdownEditor in edit mode and forwards changes to updateEditContent", () => {
    const tab = makeFileTab("edit");
    const updateEditContent = vi.fn();
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: tab.id,
      activeFile: tab.file,
      updateEditContent,
    });
    expect(getByTestId("lazy-editor")).toBeInTheDocument();
    getByTestId("lazy-editor").click();
    expect(updateEditContent).toHaveBeenCalledWith(tab.id, "EDITED");
  });

  it("renders SplitView in split mode", () => {
    const tab = makeFileTab("split");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("lazy-split")).toBeInTheDocument();
  });

  it("routes wikilink clicks through openFile", () => {
    const tab = makeFileTab("split");
    const openFile = vi.fn();
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: tab.id,
      activeFile: tab.file,
      openFile,
    });
    getByTestId("split-wikilink").click();
    expect(openFile).toHaveBeenCalledWith("/note.md");
  });

  it("renders the notebook viewer for an .ipynb tab in view mode", () => {
    const tab = makeNotebookTab("view");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("notebook-viewer")).toHaveTextContent("/p/analysis.ipynb");
    expect(screen.queryByTestId("markdown-viewer")).toBeNull();
  });

  it("renders the notebook source view for an .ipynb tab in edit mode", () => {
    const tab = makeNotebookTab("edit");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("notebook-source")).toBeInTheDocument();
    // Never the markdown editor — that would expose a write path.
    expect(screen.queryByTestId("lazy-editor")).toBeNull();
  });

  it("renders the notebook split view for an .ipynb tab in split mode", () => {
    const tab = makeNotebookTab("split");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("notebook-split")).toBeInTheDocument();
    expect(screen.queryByTestId("lazy-split")).toBeNull();
  });

  it("renders the image viewer for an image tab, even with null content", () => {
    const tab = makeImageTab();
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("image-viewer")).toHaveTextContent("/p/diagram.svg");
    // The null-content guard must not pre-empt the image branch.
    expect(screen.queryByTestId("markdown-viewer")).toBeNull();
  });

  it("renders the read-only canvas viewer for a .canvas tab in view mode", () => {
    const tab = makeCanvasTab("view");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("canvas-viewer")).toHaveTextContent("/p/board.canvas");
    expect(screen.queryByTestId("markdown-viewer")).toBeNull();
  });

  it("shows unsaved edits in the canvas viewer (editContent wins over content)", () => {
    const tab = makeCanvasTab("view");
    tab.file.editContent = '{"nodes":[{"id":"new"}],"edges":[]}';
    tab.file.dirty = true;
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("canvas-viewer")).toHaveAttribute(
      "data-content",
      tab.file.editContent,
    );
  });

  it("renders the canvas editor in edit mode and commits changes via commitEdit", () => {
    const tab = makeCanvasTab("edit");
    const commitEdit = vi.fn();
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: tab.id,
      activeFile: tab.file,
      commitEdit,
    });
    expect(getByTestId("canvas-editor")).toBeInTheDocument();
    // Canvas JSON must never reach the markdown editor.
    expect(screen.queryByTestId("lazy-editor")).toBeNull();
    getByTestId("canvas-editor").click();
    expect(commitEdit).toHaveBeenCalledWith(tab.id, "CANVAS");
  });

  it("drops canvas commits when no tab id is active", () => {
    const tab = makeCanvasTab("edit");
    const commitEdit = vi.fn();
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: null,
      activeFile: tab.file,
      commitEdit,
    });
    getByTestId("canvas-editor").click();
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it("drops editor changes when no tab id is active", () => {
    const tab = makeFileTab("edit");
    const updateEditContent = vi.fn();
    const { getByTestId } = renderTabContent({
      activeTab: tab,
      activeTabId: null,
      activeFile: tab.file,
      updateEditContent,
    });
    getByTestId("lazy-editor").click();
    expect(updateEditContent).not.toHaveBeenCalled();
  });

  it("renders the canvas editor in split mode too", () => {
    const tab = makeCanvasTab("split");
    renderTabContent({ activeTab: tab, activeTabId: tab.id, activeFile: tab.file });
    expect(screen.getByTestId("canvas-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("lazy-split")).toBeNull();
  });
});
