import { useCallback } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { useTaskList } from "@/hooks/useTaskList";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isImageFile } from "@/lib/imageExtensions";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { EDITOR_MODE } from "@/lib/settings";
import { CanvasEditor, CanvasViewer } from "./canvas/lazyCanvas";
import { MarkdownEditor, SplitView } from "./editor/lazyEditor";
import { GraphView } from "./graph/lazyGraph";
import { ImageViewer } from "./markdown/ImageViewer";
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
    workspaceFiles,
    wikilinkRefs,
    openFile,
    saveScrollPosition,
    updateEditContent,
    commitEdit,
    toggleTask,
  } = useTabsContext();

  const handleCanvasChange = useCallback(
    (serialized: string) => {
      if (activeTabId) commitEdit(activeTabId, serialized);
    },
    [activeTabId, commitEdit],
  );

  const { handleToggle: handleTaskToggle } = useTaskList({ activeTabId, toggleTask });

  const handleEditorChange = useCallback(
    (newContent: string) => {
      if (activeTabId) updateEditContent(activeTabId, newContent);
    },
    [activeTabId, updateEditContent],
  );

  // Wikilink and graph-node navigation: the target resolved against the
  // window's workspace, so it opens as a regular document tab (activating the
  // existing tab when the note is already open).
  // TODO: cross-file heading scroll — `heading` is plumbed through but not yet
  // applied after the target file finishes loading.
  const handleOpenWikilink = useCallback(
    (path: string, _heading?: string) => {
      openFile(path);
    },
    [openFile],
  );

  if (!activeTab) return null;

  // Graph tabs have no document; they render the workspace graph and open
  // clicked notes as document tabs.
  if (activeTab.kind === "graph") {
    return (
      <GraphView
        workspaceFiles={workspaceFiles}
        wikilinkRefs={wikilinkRefs}
        onOpenFile={handleOpenWikilink}
      />
    );
  }

  // `activeTab` is narrowed to a file tab here (graph returned above), so its
  // file is always present.
  const file = activeTab.file;

  // Image/SVG tabs carry no text content (they're never read as text); they
  // render straight from the asset protocol in the read-only image viewer.
  if (isImageFile(file.path)) {
    return <ImageViewer key={`${activeTab.id}:${file.path}`} filePath={file.path} />;
  }

  if (!file.content) return null;

  const editorContent = file.editContent ?? file.content;

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

  // Canvas files (JSON Canvas spec) render on an infinite pan/zoom board rather
  // than as text. View mode is the read-only board; edit mode is the full
  // editor (the split button is hidden for canvas — the board IS the editor).
  // The serialized JSON never flows through the markdown editor — edits are
  // committed straight to the tab content pipeline via commitEdit. The viewer
  // renders editorContent, not file.content, so switching back to view right
  // after an edit shows the latest board instead of the last autosaved one.
  if (isCanvasFile(file.path)) {
    if (file.mode === EDITOR_MODE.view) {
      return (
        <CanvasViewer
          key={`${activeTab.id}:${file.path}`}
          content={editorContent}
          filePath={file.path}
          onOpenFile={handleOpenWikilink}
          onChange={handleCanvasChange}
          viewportKey={`${activeTab.id}:${file.path}`}
        />
      );
    }
    return (
      <CanvasEditor
        key={`${activeTab.id}:${file.path}`}
        content={editorContent}
        filePath={file.path}
        onChange={handleCanvasChange}
        viewportKey={`${activeTab.id}:${file.path}`}
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
          onOpenWikilink={handleOpenWikilink}
          onOpenRelativeFile={openFile}
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
      onOpenRelativeFile={openFile}
      onTaskToggle={handleTaskToggle}
    />
  );
}
