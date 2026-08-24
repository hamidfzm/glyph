import { useCallback } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { useCanSplit } from "@/hooks/useMediaQuery";
import { useTaskList } from "@/hooks/useTaskList";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isImageFile } from "@/lib/imageExtensions";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { EDITOR_MODE, effectiveEditorMode } from "@/lib/settings";
import { CanvasPane } from "./CanvasPane";
import { MarkdownEditor, SplitView } from "./editor/lazyEditor";
import { GraphView } from "./graph/lazyGraph";
import { ImageViewer } from "./markdown/ImageViewer";
import { MarkdownViewer } from "./markdown/MarkdownViewer";
import { NoteZoomLayer } from "./markdown/NoteZoomLayer";
import { NotebookPane } from "./NotebookPane";

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
  // Split needs two panes' width; on a narrow (phone) viewport a split tab
  // renders as the single-pane view instead. See effectiveEditorMode.
  const canSplit = useCanSplit();

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
  const mode = effectiveEditorMode(file.mode, canSplit);

  // Image/SVG tabs carry no text content (they're never read as text); they
  // render straight from the asset protocol in the read-only image viewer.
  if (isImageFile(file.path)) {
    return <ImageViewer key={`${activeTab.id}:${file.path}`} filePath={file.path} />;
  }

  // null is the loading/absent state; the empty string is a valid empty
  // document and must still render the editor/viewer shell.
  if (file.content == null) return null;

  const editorContent = file.editContent ?? file.content;

  if (isNotebookFile(file.path)) {
    return (
      <NotebookPane
        tabId={activeTab.id}
        file={file}
        content={file.content}
        mode={mode}
        searchOpen={searchOpen}
        onSearchClose={onSearchClose}
        onScrollChange={saveScrollPosition}
      />
    );
  }

  if (isCanvasFile(file.path)) {
    return (
      <CanvasPane
        tabId={activeTab.id}
        file={file}
        content={editorContent}
        onOpenFile={handleOpenWikilink}
        onChange={handleCanvasChange}
      />
    );
  }

  if (mode === EDITOR_MODE.edit) {
    return (
      <NoteZoomLayer tabId={activeTab.id}>
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor
            content={editorContent}
            onChange={handleEditorChange}
            workspaceFiles={workspaceFiles}
            searchOpen={searchOpen}
            onSearchClose={onSearchClose}
          />
        </div>
      </NoteZoomLayer>
    );
  }

  if (mode === EDITOR_MODE.split) {
    return (
      <NoteZoomLayer tabId={activeTab.id}>
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
      </NoteZoomLayer>
    );
  }

  return (
    <NoteZoomLayer tabId={activeTab.id}>
      <MarkdownViewer
        key={`${activeTab.id}:${file.path}`}
        content={file.content}
        filePath={file.path}
        initialScrollTop={file.scrollTop}
        onScrollChange={saveScrollPosition}
        // Workspace search jumps to a hit's source line via these markers.
        sourceLines
        searchOpen={searchOpen}
        onSearchClose={onSearchClose}
        workspaceFiles={workspaceFiles}
        onOpenWikilink={handleOpenWikilink}
        onOpenRelativeFile={openFile}
        onTaskToggle={handleTaskToggle}
      />
    </NoteZoomLayer>
  );
}
