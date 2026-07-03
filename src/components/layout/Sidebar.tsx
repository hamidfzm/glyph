import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CollapseAllIcon } from "@/components/icons/CollapseAllIcon";
import { ExpandAllIcon } from "@/components/icons/ExpandAllIcon";
import { NewFolderIcon } from "@/components/icons/NewFolderIcon";
import { NewNoteIcon } from "@/components/icons/NewNoteIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useActiveHeading } from "@/hooks/useActiveHeading";
import { usePanelResize } from "@/hooks/usePanelResize";
import type { Workspace } from "@/hooks/useTabs";
import { BACKLINKS_HEIGHT_MIN } from "@/lib/settings";
import { BacklinksSection } from "./BacklinksSection";
import { EdgeExpand } from "./EdgeExpand";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { OutlineSection } from "./OutlineSection";
import { PanelHeader } from "./PanelHeader";
import { ResizeHandle } from "./ResizeHandle";
import { SidebarPanel } from "./SidebarPanel";
import { ToolbarButton } from "./ToolbarButton";

interface SidebarProps {
  side: "left" | "right";
}

// Keep at least this much of the Files panel for the tree when dragging the
// backlinks divider up.
const BACKLINKS_TREE_RESERVE = 120;

export function Sidebar({ side }: SidebarProps) {
  const { t } = useTranslation("common");
  const {
    activeTab,
    activeFile,
    workspace,
    tocEntries,
    backlinks,
    toggleExpand: onToggleExpand,
    openFile: onOpenFile,
    closeWorkspace,
    createNote,
    createCanvas,
    createFolder,
    renamePath,
    duplicatePath,
    movePath,
    collapseAll,
    expandAll,
    deletePath,
  } = useTabsContext();
  const fileTreeRef = useRef<FileTreeHandle>(null);

  // "Move to…": pick a destination folder (within the workspace), then relocate.
  const handleMove = useCallback(
    async (root: string, from: string) => {
      const dir = await open({ directory: true, defaultPath: root });
      if (typeof dir === "string") movePath(from, dir);
    },
    [movePath],
  );
  const {
    filesVisible,
    outlineVisible,
    sidebarLayout,
    swapSidebarSides,
    filesSidebarWidth,
    outlineSidebarWidth,
    backlinksHeight,
    setFilesSidebarWidth,
    setOutlineSidebarWidth,
    setBacklinksHeight,
    toggleFiles: onToggleFiles,
    toggleOutline: onToggleOutline,
  } = useSidebarLayoutContext();
  const activeId = useActiveHeading(tocEntries);

  // Vertical divider between the file tree and the backlinks block. The idle
  // height is DOM-measured so a drag starts from the rendered height even when
  // the block is auto-sized; double-click restores auto.
  const backlinksRef = useRef<HTMLDivElement>(null);
  const backlinksMax = useCallback(
    () =>
      Math.max(
        BACKLINKS_HEIGHT_MIN,
        (backlinksRef.current?.parentElement?.clientHeight ?? 0) - BACKLINKS_TREE_RESERVE,
      ),
    [],
  );
  const backlinksResize = usePanelResize({
    size: () => backlinksRef.current?.offsetHeight ?? BACKLINKS_HEIGHT_MIN,
    min: BACKLINKS_HEIGHT_MIN,
    max: backlinksMax,
    axis: "y",
    // The block sits at the panel bottom: dragging the divider up grows it.
    direction: -1,
    onCommit: setBacklinksHeight,
    onReset: () => setBacklinksHeight(null),
  });

  // The files panel follows the window's workspace; the outline follows the
  // active document. With neither there is nothing to show.
  if (!workspace && !activeTab) return null;
  const hasOutlineContent = tocEntries.length > 0;
  const showOutline = outlineVisible && hasOutlineContent;

  // Resolve which physical side each panel sits on. Default Files-left /
  // Outline-right; swap flips both. For non-split layouts the panels live
  // together on the "primary" side (where Files would normally be).
  const filesSide: "left" | "right" = swapSidebarSides ? "right" : "left";
  const outlineSide: "left" | "right" = swapSidebarSides ? "left" : "right";
  const primarySide: "left" | "right" = filesSide;

  // Helpers for the file-tree + outline content blocks.
  const folderName = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  const renderFilesBlock = (ws: Workspace, headerSide: "left" | "right") => (
    <div className="px-3 pb-3 flex-1 flex flex-col min-h-0">
      <PanelHeader
        label={folderName(ws.root)}
        side={headerSide}
        onCollapse={onToggleFiles}
        collapseTitle={t("sidebar.hideFiles")}
        actions={
          <>
            <ToolbarButton
              title={t("sidebar.newNote")}
              onClick={() => fileTreeRef.current?.createNote()}
            >
              <NewNoteIcon />
            </ToolbarButton>
            <ToolbarButton
              title={t("sidebar.newFolder")}
              onClick={() => fileTreeRef.current?.createFolder()}
            >
              <NewFolderIcon />
            </ToolbarButton>
            {ws.expanded.size > 0 ? (
              <ToolbarButton title={t("sidebar.collapseAll")} onClick={() => collapseAll()}>
                <CollapseAllIcon />
              </ToolbarButton>
            ) : (
              <ToolbarButton title={t("sidebar.expandAll")} onClick={() => expandAll()}>
                <ExpandAllIcon />
              </ToolbarButton>
            )}
            <ToolbarButton title={t("sidebar.closeWorkspace")} onClick={closeWorkspace}>
              <TabCloseIcon />
            </ToolbarButton>
          </>
        }
      />
      {/* The tree scrolls inside its own region so a long file list can't spill
          over the backlinks block pinned below it (visible when the panel is
          short, e.g. with devtools open). */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <FileTree
          ref={fileTreeRef}
          root={ws.root}
          nodes={ws.nodes}
          expanded={ws.expanded}
          activeFilePath={activeFile?.path}
          onToggle={onToggleExpand}
          onOpenFile={onOpenFile}
          onCreateNote={createNote}
          onCreateCanvas={createCanvas}
          onCreateFolder={createFolder}
          onRename={renamePath}
          onDuplicate={duplicatePath}
          onMove={(path) => handleMove(ws.root, path)}
          onReveal={(path) => {
            void revealItemInDir(path);
          }}
          onDelete={deletePath}
        />
      </div>
      {backlinks.length > 0 && (
        <>
          <ResizeHandle
            axis="y"
            label={t("sidebar.resizeBacklinks")}
            value={backlinksResize.size ?? backlinksHeight ?? BACKLINKS_HEIGHT_MIN}
            min={BACKLINKS_HEIGHT_MIN}
            max={backlinksMax()}
            className="mt-3 -mx-3 h-1.5 shrink-0"
            {...backlinksResize.handleProps}
          />
          <div
            ref={backlinksRef}
            className="pt-1.5 border-t border-[var(--color-border)] shrink-0 overflow-y-auto"
            style={{ height: backlinksResize.size ?? backlinksHeight ?? undefined }}
          >
            <BacklinksSection backlinks={backlinks} workspaceRoot={ws.root} onOpen={onOpenFile} />
          </div>
        </>
      )}
    </div>
  );

  const renderOutlineBlock = (headerSide: "left" | "right") => (
    <div className="px-3 pb-3">
      <PanelHeader
        label={t("sidebar.outline")}
        side={headerSide}
        onCollapse={onToggleOutline}
        collapseTitle={t("sidebar.hideOutline")}
      />
      <OutlineSection entries={tocEntries} activeId={activeId} />
    </div>
  );

  if (workspace) {
    if (sidebarLayout === "combined") {
      // Single panel on the primary side, Files + Outline stacked. One panel
      // has one width, so combined mode deliberately resizes (and persists)
      // the Files width; the Outline width only applies in split/beside.
      if (side !== primarySide) return null;
      if (filesVisible || showOutline) {
        return (
          <SidebarPanel
            width={filesSidebarWidth}
            side={primarySide}
            onWidthCommit={setFilesSidebarWidth}
          >
            {filesVisible && renderFilesBlock(workspace, primarySide)}
            {filesVisible && showOutline && (
              <div className="border-t border-[var(--color-border)] pt-3">
                {renderOutlineBlock(primarySide)}
              </div>
            )}
            {!filesVisible && showOutline && renderOutlineBlock(primarySide)}
          </SidebarPanel>
        );
      }
      return (
        <EdgeExpand
          side={primarySide}
          onClick={onToggleFiles}
          title={t("sidebar.showFiles")}
          panel="files"
        />
      );
    }

    if (sidebarLayout === "beside") {
      // Two panels next to each other on the primary side. With swap=false the
      // order is Files (outermost) | Outline | content. With swap=true it's
      // content | Outline | Files (still adjacent on the right edge).
      if (side !== primarySide) return null;
      const filesPanel = filesVisible ? (
        <SidebarPanel
          width={filesSidebarWidth}
          side={primarySide}
          onWidthCommit={setFilesSidebarWidth}
        >
          {renderFilesBlock(workspace, primarySide)}
        </SidebarPanel>
      ) : (
        <EdgeExpand
          side={primarySide}
          onClick={onToggleFiles}
          title={t("sidebar.showFiles")}
          panel="files"
        />
      );
      const outlinePanel = showOutline ? (
        <SidebarPanel
          width={outlineSidebarWidth}
          side={primarySide}
          onWidthCommit={setOutlineSidebarWidth}
        >
          {renderOutlineBlock(primarySide)}
        </SidebarPanel>
      ) : hasOutlineContent ? (
        <EdgeExpand
          side={primarySide}
          onClick={onToggleOutline}
          title={t("sidebar.showOutline")}
          panel="outline"
        />
      ) : null;
      // Outermost = Files; inner (toward content) = Outline.
      return (
        <>
          {filesPanel}
          {outlinePanel}
        </>
      );
    }

    // Split layout (default): Files on filesSide, Outline on outlineSide.
    if (side === filesSide) {
      if (filesVisible) {
        return (
          <SidebarPanel
            width={filesSidebarWidth}
            side={filesSide}
            onWidthCommit={setFilesSidebarWidth}
          >
            {renderFilesBlock(workspace, filesSide)}
          </SidebarPanel>
        );
      }
      return (
        <EdgeExpand
          side={filesSide}
          onClick={onToggleFiles}
          title={t("sidebar.showFiles")}
          panel="files"
        />
      );
    }
    if (showOutline) {
      return (
        <SidebarPanel
          width={outlineSidebarWidth}
          side={outlineSide}
          onWidthCommit={setOutlineSidebarWidth}
        >
          {renderOutlineBlock(outlineSide)}
        </SidebarPanel>
      );
    }
    if (hasOutlineContent && !outlineVisible) {
      return (
        <EdgeExpand
          side={outlineSide}
          onClick={onToggleOutline}
          title={t("sidebar.showOutline")}
          panel="outline"
        />
      );
    }
    return null;
  }

  // No workspace: outline is the only sidebar; rendered on the primary side.
  if (side !== primarySide) return null;
  if (showOutline) {
    return (
      <SidebarPanel
        width={outlineSidebarWidth}
        side={primarySide}
        onWidthCommit={setOutlineSidebarWidth}
      >
        {renderOutlineBlock(primarySide)}
      </SidebarPanel>
    );
  }
  if (hasOutlineContent && !outlineVisible) {
    return (
      <EdgeExpand
        side={primarySide}
        onClick={onToggleOutline}
        title={t("sidebar.showOutline")}
        panel="outline"
      />
    );
  }
  return null;
}
