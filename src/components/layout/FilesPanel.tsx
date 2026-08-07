import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CollapseAllIcon } from "@/components/icons/CollapseAllIcon";
import { ExpandAllIcon } from "@/components/icons/ExpandAllIcon";
import { NewFolderIcon } from "@/components/icons/NewFolderIcon";
import { NewNoteIcon } from "@/components/icons/NewNoteIcon";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { pathsWithTag, tagCounts } from "@/lib/metadata";
import { lastSegment } from "@/lib/paths";
import { pickMoveDir } from "@/lib/pickers";
import type { Workspace } from "@/lib/tabs";
import { BacklinksBlock } from "./BacklinksBlock";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { PanelHeader } from "./PanelHeader";
import { TagFileList } from "./TagFileList";
import { TagsBlock } from "./TagsBlock";
import { ToolbarButton } from "./ToolbarButton";
import { WorkspaceIndexWarning } from "./WorkspaceIndexWarning";

interface FilesPanelProps {
  workspace: Workspace;
  /** Physical side the panel sits on, so the header's collapse chevron points out. */
  headerSide: "left" | "right";
}

/** The Files panel body: workspace toolbar, the tree (or a tag-filtered list),
 *  the tag cloud, and the resizable backlinks block. */
export function FilesPanel({ workspace, headerSide }: FilesPanelProps) {
  const { t } = useTranslation("common");
  const {
    activeFile,
    metadata,
    toggleExpand,
    openFile,
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
  const { compact, closeCompactPanels, toggleFiles } = useSidebarLayoutContext();
  const fileTreeRef = useRef<FileTreeHandle>(null);

  // The filter carries the workspace it was picked in, and applies only while
  // that tag still exists: a switched workspace or a tag edited away falls back
  // to the tree instead of stranding the panel on a stale list.
  const [tagFilter, setTagFilter] = useState<{ root: string; tag: string } | null>(null);
  const tags = useMemo(() => tagCounts(metadata), [metadata]);
  const selectedTag = tagFilter && tagFilter.root === workspace.root ? tagFilter.tag : null;
  const activeTag = tags.some((tag) => tag.tag === selectedTag) ? selectedTag : null;
  const taggedPaths = useMemo(
    () => (activeTag ? pathsWithTag(metadata, activeTag) : []),
    [metadata, activeTag],
  );

  // On a phone the sidebar is a drawer over the document, so opening a file
  // dismisses it, otherwise the freshly opened doc stays hidden behind it.
  const handleOpenFile = useCallback(
    (path: string) => {
      openFile(path);
      if (compact) closeCompactPanels();
    },
    [openFile, compact, closeCompactPanels],
  );

  // "Move to…": pick a destination folder (within the workspace), then relocate.
  const handleMove = useCallback(
    async (from: string) => {
      const dir = await pickMoveDir(workspace.root);
      if (typeof dir === "string") movePath(from, dir);
    },
    [movePath, workspace.root],
  );

  return (
    <div className="px-3 pb-3 flex-1 flex flex-col min-h-0">
      <PanelHeader
        label={lastSegment(workspace.root)}
        side={headerSide}
        onCollapse={toggleFiles}
        collapseTitle={t("sidebar.hideFiles")}
        actions={
          <>
            {/* Create and expand/collapse act on the tree, which the tag
                filter replaces, so they only show alongside it. */}
            {!activeTag && (
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
                {workspace.expanded.size > 0 ? (
                  <ToolbarButton title={t("sidebar.collapseAll")} onClick={() => collapseAll()}>
                    <CollapseAllIcon />
                  </ToolbarButton>
                ) : (
                  <ToolbarButton title={t("sidebar.expandAll")} onClick={() => expandAll()}>
                    <ExpandAllIcon />
                  </ToolbarButton>
                )}
              </>
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
        {activeTag ? (
          <TagFileList
            tag={activeTag}
            paths={taggedPaths}
            workspaceRoot={workspace.root}
            activeFilePath={activeFile?.path}
            onOpen={handleOpenFile}
            onClear={() => setTagFilter(null)}
          />
        ) : (
          <FileTree
            ref={fileTreeRef}
            root={workspace.root}
            nodes={workspace.nodes}
            expanded={workspace.expanded}
            activeFilePath={activeFile?.path}
            onToggle={toggleExpand}
            onOpenFile={handleOpenFile}
            onCreateNote={createNote}
            onCreateCanvas={createCanvas}
            onCreateFolder={createFolder}
            onRename={renamePath}
            onDuplicate={duplicatePath}
            onMove={handleMove}
            onReveal={(path) => {
              void revealItemInDir(path);
            }}
            onDelete={deletePath}
          />
        )}
      </div>
      <TagsBlock
        tags={tags}
        selected={activeTag}
        onSelect={(tag) => setTagFilter(tag ? { root: workspace.root, tag } : null)}
      />
      <WorkspaceIndexWarning />
      <BacklinksBlock workspaceRoot={workspace.root} onOpen={handleOpenFile} />
    </div>
  );
}
