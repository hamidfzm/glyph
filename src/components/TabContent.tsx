import { useCallback } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { activeFileOf, type FolderTab } from "@/hooks/useTabs";
import { useTaskList } from "@/hooks/useTaskList";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { EDITOR_MODE } from "@/lib/settings";
import { MarkdownEditor, SplitView } from "./editor/lazyEditor";
import { GraphView } from "./graph/lazyGraph";
import { MarkdownViewer } from "./markdown/MarkdownViewer";
import { NotebookSource, NotebookSplit, NotebookViewer } from "./notebook/lazyNotebook";

interface TabContentProps {
  searchOpen: boolean;
  onSearchClose: () => void;
}

// Renders the document area for the active tab. Switches between
// MarkdownEditor (edit), SplitView (split), and MarkdownViewer (view) based on
// the per-tab mode. Returns null when there's no displayable file.
export function TabContent({ searchOpen, onSearchClose }: TabContentProps) {
  const {
    activeTab,
    activeTabId,
    tabs,
    setActiveTab,
    workspaceFiles,
    wikilinkRefs,
    openFileInFolderTab,
    saveScrollPosition,
    updateEditContent,
    toggleTask,
  } = useTabsContext();

  const { handleToggle: handleTaskToggle } = useTaskList({ activeTabId, toggleTask });

  const handleEditorChange = useCallback(
    (newContent: string) => {
      if (activeTabId) updateEditContent(activeTabId, newContent);
    },
    [activeTabId, updateEditContent],
  );

  // Wikilink navigation: only meaningful inside a folder tab; outside one,
  // there's no workspace to resolve against, so the call is dropped.
  // TODO: cross-file heading scroll — `heading` is plumbed through but not yet
  // applied after the target file finishes loading.
  const handleOpenWikilink = useCallback(
    (path: string, _heading?: string) => {
      if (activeTabId && activeTab?.kind === "folder") {
        openFileInFolderTab(activeTabId, path);
      }
    },
    [activeTabId, activeTab, openFileInFolderTab],
  );

  // Graph node click: open the note inside the folder tab that owns the
  // graph's workspace, then bring that tab to the front.
  const handleOpenGraphNode = useCallback(
    (path: string) => {
      if (activeTab?.kind !== "graph") return;
      const folderTab = tabs.find(
        (t): t is FolderTab => t.kind === "folder" && t.root === activeTab.root,
      );
      if (!folderTab) return;
      openFileInFolderTab(folderTab.id, path);
      setActiveTab(folderTab.id);
    },
    [activeTab, tabs, openFileInFolderTab, setActiveTab],
  );

  if (!activeTab) return null;

  // Graph tabs have no document; they render the workspace graph and route
  // node clicks into the folder tab that owns the workspace.
  if (activeTab.kind === "graph") {
    return (
      <GraphView
        workspaceFiles={workspaceFiles}
        wikilinkRefs={wikilinkRefs}
        onOpenFile={handleOpenGraphNode}
      />
    );
  }

  const file = activeFileOf(activeTab);
  if (!file?.content) return null;

  const editorContent = file.editContent ?? file.content;
  const workspaceRoot = activeTab.kind === "folder" ? activeTab.root : undefined;

  // Notebooks are read-only, so the three modes map to read-only views rather
  // than editors: view = rendered cells, split = cells + raw JSON side by side,
  // edit = raw JSON source. None drop the JSON into the markdown editor, which
  // would let autosave write malformed content back and corrupt the file.
  if (isNotebookFile(file.path)) {
    const NotebookComponent =
      file.mode === EDITOR_MODE.view
        ? NotebookViewer
        : file.mode === EDITOR_MODE.split
          ? NotebookSplit
          : NotebookSource;
    return (
      <NotebookComponent
        key={`${activeTab.id}:${file.path}`}
        content={file.content}
        filePath={file.path}
        initialScrollTop={file.scrollTop}
        onScrollChange={saveScrollPosition}
        searchOpen={searchOpen}
        onSearchClose={onSearchClose}
      />
    );
  }

  if (file.mode === EDITOR_MODE.edit) {
    return (
      <div className="flex-1 overflow-hidden">
        <MarkdownEditor
          content={editorContent}
          onChange={handleEditorChange}
          workspaceFiles={workspaceFiles}
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  if (file.mode === EDITOR_MODE.split) {
    return (
      <div className="flex-1 overflow-hidden">
        <SplitView
          content={editorContent}
          filePath={file.path}
          onChange={handleEditorChange}
          searchOpen={searchOpen}
          onSearchClose={onSearchClose}
          workspaceFiles={workspaceFiles}
          workspaceRoot={workspaceRoot}
          onOpenWikilink={handleOpenWikilink}
          onTaskToggle={handleTaskToggle}
        />
      </div>
    );
  }

  return (
    <MarkdownViewer
      key={`${activeTab.id}:${file.path}`}
      content={file.content}
      filePath={file.path}
      initialScrollTop={file.scrollTop}
      onScrollChange={saveScrollPosition}
      searchOpen={searchOpen}
      onSearchClose={onSearchClose}
      workspaceFiles={workspaceFiles}
      onOpenWikilink={handleOpenWikilink}
      onTaskToggle={handleTaskToggle}
    />
  );
}
