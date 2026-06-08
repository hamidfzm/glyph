import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useRef } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useActiveHeading } from "@/hooks/useActiveHeading";
import type { Tab } from "@/hooks/useTabs";
import { CollapseAllIcon } from "../icons/CollapseAllIcon";
import { ExpandAllIcon } from "../icons/ExpandAllIcon";
import { NewFolderIcon } from "../icons/NewFolderIcon";
import { NewNoteIcon } from "../icons/NewNoteIcon";
import { BacklinksSection } from "./BacklinksSection";
import { EdgeExpand } from "./EdgeExpand";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { OutlineSection } from "./OutlineSection";
import { PanelHeader } from "./PanelHeader";
import { SidebarPanel } from "./SidebarPanel";
import { ToolbarButton } from "./ToolbarButton";

interface SidebarProps {
  side: "left" | "right";
}

const DEFAULT_WIDTH = 224;

export function Sidebar({ side }: SidebarProps) {
  const {
    activeTab,
    tocEntries,
    backlinks,
    toggleExpand: onToggleExpand,
    openFileInFolderTab: onOpenFileInTab,
    openFile: onOpenFileInNewTab,
    createNote,
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
    async (tabId: string, root: string, from: string) => {
      const dir = await open({ directory: true, defaultPath: root });
      if (typeof dir === "string") movePath(tabId, from, dir);
    },
    [movePath],
  );
  const {
    filesVisible,
    outlineVisible,
    sidebarLayout,
    swapSidebarSides,
    sidebarWidth,
    toggleFiles: onToggleFiles,
    toggleOutline: onToggleOutline,
  } = useSidebarLayoutContext();
  const activeId = useActiveHeading(tocEntries);

  if (!activeTab) return null;
  const w = sidebarWidth ?? DEFAULT_WIDTH;
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

  const renderFilesBlock = (
    folder: Extract<Tab, { kind: "folder" }>,
    headerSide: "left" | "right",
  ) => (
    <div className="px-3 pb-3 flex-1 flex flex-col min-h-0">
      <PanelHeader
        label={folderName(folder.root)}
        side={headerSide}
        onCollapse={onToggleFiles}
        collapseTitle="Hide files sidebar"
        actions={
          <>
            <ToolbarButton title="New note" onClick={() => fileTreeRef.current?.createNote()}>
              <NewNoteIcon />
            </ToolbarButton>
            <ToolbarButton title="New folder" onClick={() => fileTreeRef.current?.createFolder()}>
              <NewFolderIcon />
            </ToolbarButton>
            {folder.expanded.size > 0 ? (
              <ToolbarButton title="Collapse all" onClick={() => collapseAll(folder.id)}>
                <CollapseAllIcon />
              </ToolbarButton>
            ) : (
              <ToolbarButton title="Expand all" onClick={() => expandAll(folder.id)}>
                <ExpandAllIcon />
              </ToolbarButton>
            )}
          </>
        }
      />
      <FileTree
        ref={fileTreeRef}
        root={folder.root}
        nodes={folder.nodes}
        expanded={folder.expanded}
        activeFilePath={folder.file?.path}
        onToggle={(path) => onToggleExpand(folder.id, path)}
        onOpenFile={(path) => onOpenFileInTab(folder.id, path)}
        onOpenFileInNewTab={onOpenFileInNewTab}
        onCreateNote={(dir) => createNote(folder.id, dir)}
        onCreateFolder={(dir) => createFolder(folder.id, dir)}
        onRename={(path, newName) => renamePath(folder.id, path, newName)}
        onDuplicate={(path) => duplicatePath(folder.id, path)}
        onMove={(path) => handleMove(folder.id, folder.root, path)}
        onReveal={(path) => {
          void revealItemInDir(path);
        }}
        onDelete={(path) => deletePath(folder.id, path)}
      />
      {backlinks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
          <BacklinksSection
            backlinks={backlinks}
            workspaceRoot={folder.root}
            onOpen={(path) => onOpenFileInTab(folder.id, path)}
          />
        </div>
      )}
    </div>
  );

  const renderOutlineBlock = (headerSide: "left" | "right") => (
    <div className="px-3 pb-3">
      <PanelHeader
        label="Outline"
        side={headerSide}
        onCollapse={onToggleOutline}
        collapseTitle="Hide outline sidebar"
      />
      <OutlineSection entries={tocEntries} activeId={activeId} />
    </div>
  );

  if (activeTab.kind === "folder") {
    const folderTab = activeTab;

    if (sidebarLayout === "combined") {
      // Single panel on the primary side, Files + Outline stacked.
      if (side !== primarySide) return null;
      if (filesVisible || showOutline) {
        return (
          <SidebarPanel width={w} side={primarySide}>
            {filesVisible && renderFilesBlock(folderTab, primarySide)}
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
          title="Show files sidebar"
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
        <SidebarPanel width={w} side={primarySide}>
          {renderFilesBlock(folderTab, primarySide)}
        </SidebarPanel>
      ) : (
        <EdgeExpand
          side={primarySide}
          onClick={onToggleFiles}
          title="Show files sidebar"
          panel="files"
        />
      );
      const outlinePanel = showOutline ? (
        <SidebarPanel width={w} side={primarySide}>
          {renderOutlineBlock(primarySide)}
        </SidebarPanel>
      ) : hasOutlineContent ? (
        <EdgeExpand
          side={primarySide}
          onClick={onToggleOutline}
          title="Show outline sidebar"
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
          <SidebarPanel width={w} side={filesSide}>
            {renderFilesBlock(folderTab, filesSide)}
          </SidebarPanel>
        );
      }
      return (
        <EdgeExpand
          side={filesSide}
          onClick={onToggleFiles}
          title="Show files sidebar"
          panel="files"
        />
      );
    }
    if (showOutline) {
      return (
        <SidebarPanel width={w} side={outlineSide}>
          {renderOutlineBlock(outlineSide)}
        </SidebarPanel>
      );
    }
    if (hasOutlineContent && !outlineVisible) {
      return (
        <EdgeExpand
          side={outlineSide}
          onClick={onToggleOutline}
          title="Show outline sidebar"
          panel="outline"
        />
      );
    }
    return null;
  }

  // File tab: outline is the only sidebar; rendered on the primary side.
  if (side !== primarySide) return null;
  if (showOutline) {
    return (
      <SidebarPanel width={w} side={primarySide}>
        {renderOutlineBlock(primarySide)}
      </SidebarPanel>
    );
  }
  if (hasOutlineContent && !outlineVisible) {
    return (
      <EdgeExpand
        side={primarySide}
        onClick={onToggleOutline}
        title="Show outline sidebar"
        panel="outline"
      />
    );
  }
  return null;
}
