import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { EdgeExpand } from "./EdgeExpand";
import { FilesPanel } from "./FilesPanel";
import { OutlinePanel } from "./OutlinePanel";
import { SidebarPanel } from "./SidebarPanel";

interface SidebarProps {
  side: "left" | "right";
}

// Which physical side each panel occupies and whether it is expanded, for the
// three sidebar layouts. The panel bodies live in FilesPanel / OutlinePanel;
// this component is only the placement.
export function Sidebar({ side }: SidebarProps) {
  const { t } = useTranslation("common");
  const { activeTab, workspace, tocEntries } = useTabsContext();
  const {
    filesVisible,
    outlineVisible,
    sidebarLayout,
    swapSidebarSides,
    filesSidebarWidth,
    outlineSidebarWidth,
    setFilesSidebarWidth,
    setOutlineSidebarWidth,
    toggleFiles: onToggleFiles,
    toggleOutline: onToggleOutline,
  } = useSidebarLayoutContext();

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

  const filesEdge = (edgeSide: "left" | "right") => (
    <EdgeExpand
      side={edgeSide}
      onClick={onToggleFiles}
      title={t("sidebar.showFiles")}
      panel="files"
    />
  );
  const outlineEdge = (edgeSide: "left" | "right") => (
    <EdgeExpand
      side={edgeSide}
      onClick={onToggleOutline}
      title={t("sidebar.showOutline")}
      panel="outline"
    />
  );

  if (workspace) {
    if (sidebarLayout === "combined") {
      // Single panel on the primary side, Files + Outline stacked. One panel
      // has one width, so combined mode deliberately resizes (and persists)
      // the Files width; the Outline width only applies in split/beside.
      if (side !== primarySide) return null;
      if (!filesVisible && !showOutline) return filesEdge(primarySide);
      return (
        <SidebarPanel
          width={filesSidebarWidth}
          side={primarySide}
          onWidthCommit={setFilesSidebarWidth}
        >
          {filesVisible && <FilesPanel workspace={workspace} headerSide={primarySide} />}
          {filesVisible && showOutline && (
            <div className="border-t border-[var(--color-border)] pt-3">
              <OutlinePanel headerSide={primarySide} />
            </div>
          )}
          {!filesVisible && showOutline && <OutlinePanel headerSide={primarySide} />}
        </SidebarPanel>
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
          <FilesPanel workspace={workspace} headerSide={primarySide} />
        </SidebarPanel>
      ) : (
        filesEdge(primarySide)
      );
      const outlinePanel = showOutline ? (
        <SidebarPanel
          width={outlineSidebarWidth}
          side={primarySide}
          onWidthCommit={setOutlineSidebarWidth}
        >
          <OutlinePanel headerSide={primarySide} />
        </SidebarPanel>
      ) : hasOutlineContent ? (
        outlineEdge(primarySide)
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
      if (!filesVisible) return filesEdge(filesSide);
      return (
        <SidebarPanel
          width={filesSidebarWidth}
          side={filesSide}
          onWidthCommit={setFilesSidebarWidth}
        >
          <FilesPanel workspace={workspace} headerSide={filesSide} />
        </SidebarPanel>
      );
    }
    if (showOutline) {
      return (
        <SidebarPanel
          width={outlineSidebarWidth}
          side={outlineSide}
          onWidthCommit={setOutlineSidebarWidth}
        >
          <OutlinePanel headerSide={outlineSide} />
        </SidebarPanel>
      );
    }
    if (hasOutlineContent) return outlineEdge(outlineSide);
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
        <OutlinePanel headerSide={primarySide} />
      </SidebarPanel>
    );
  }
  if (hasOutlineContent) return outlineEdge(primarySide);
  return null;
}
