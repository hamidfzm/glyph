import { useCallback, useEffect, useRef, useState } from "react";
import type { TocEntry } from "../../hooks/useTableOfContents";
import type { Tab } from "../../hooks/useTabs";
import { onActiveHeadingChange, scrollToHeading } from "../../lib/scrollToHeading";
import type { SidebarLayout } from "../../lib/settings";
import { FolderIcon } from "../icons/FolderIcon";
import { OutlineIcon } from "../icons/OutlineIcon";
import { PanelCollapseIcon } from "../icons/PanelCollapseIcon";
import { FileTree } from "./FileTree";

interface SidebarProps {
  side: "left" | "right";
  activeTab: Tab | null;
  tocEntries: TocEntry[];
  filesVisible: boolean;
  outlineVisible: boolean;
  sidebarLayout: SidebarLayout;
  // When true, swap which screen side each panel lives on. Default layout is
  // Files-left / Outline-right; with this flag it becomes Files-right / Outline-left.
  swapSidebarSides: boolean;
  width?: number;
  onToggleFiles: () => void;
  onToggleOutline: () => void;
  onToggleExpand: (tabId: string, path: string) => void;
  onOpenFileInTab: (tabId: string, path: string) => void;
  onOpenFileInNewTab: (path: string) => void;
}

const DEFAULT_WIDTH = 224;

// How long to ignore observer updates after a programmatic scroll. Smooth
// scrolls in modern browsers complete in ~300-500ms; during that window the
// observer fires many times as intermediate headings cross the observation
// band, and would override the heading the user actually clicked on.
const SCROLL_LOCK_MS = 700;

function useActiveHeading(entries: TocEntry[]) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lockUntilRef = useRef(0);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (entries.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (intersections) => {
        if (performance.now() < lockUntilRef.current) return;
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20px 0px -60% 0px", threshold: 0.1 },
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [entries]);

  // Sync immediately on programmatic scrolls and lock the observer so it
  // doesn't override us while the smooth scroll is still in flight.
  useEffect(
    () =>
      onActiveHeadingChange((id) => {
        lockUntilRef.current = performance.now() + SCROLL_LOCK_MS;
        setActiveId(id);
      }),
    [],
  );

  return activeId;
}

interface PanelHeaderProps {
  label: string;
  side: "left" | "right";
  onCollapse: () => void;
  collapseTitle: string;
}

function PanelHeader({ label, side, onCollapse, collapseTitle }: PanelHeaderProps) {
  const chevronDirection = side === "left" ? "left" : "right";
  return (
    <div className="flex items-center justify-between gap-2 px-2 mb-2">
      <h3
        className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider truncate"
        title={label}
      >
        {label}
      </h3>
      <button
        type="button"
        onClick={onCollapse}
        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] p-0.5 rounded-[var(--glyph-radius-sm)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
        title={collapseTitle}
        aria-label={collapseTitle}
      >
        <PanelCollapseIcon direction={chevronDirection} />
      </button>
    </div>
  );
}

function OutlineSection({ entries, activeId }: { entries: TocEntry[]; activeId: string }) {
  const scrollTo = useCallback((id: string) => {
    scrollToHeading(id);
  }, []);

  if (entries.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => scrollTo(entry.id)}
            className={`w-full text-left text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors ${
              activeId === entry.id
                ? "bg-[var(--color-accent)] text-white font-medium"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
            }`}
            style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
            title={entry.text}
          >
            {entry.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SidebarPanel({
  width,
  side,
  children,
}: {
  width: number;
  side: "left" | "right";
  children: React.ReactNode;
}) {
  const borderClass = side === "left" ? "border-r" : "border-l";
  return (
    <nav
      data-print-hide="true"
      data-sidebar={side}
      className={`shrink-0 overflow-y-auto ${borderClass} border-[var(--color-border)] select-none pt-3`}
      style={{ width, background: "var(--glyph-sidebar-bg)" }}
    >
      {children}
    </nav>
  );
}

interface EdgeExpandProps {
  side: "left" | "right";
  onClick: () => void;
  title: string;
  // Glyph for the panel that's hidden — folder icon for Files, outline icon
  // for Outline. More meaningful than a generic chevron.
  panel: "files" | "outline";
}

// Vertical strip on the screen edge, shown when a sidebar panel is hidden but
// its content is available. Shows the panel's own icon so it reads as
// "click to bring back the [folder/outline] panel".
function EdgeExpand({ side, onClick, title, panel }: EdgeExpandProps) {
  const borderClass = side === "left" ? "border-r" : "border-l";
  const Icon = panel === "files" ? FolderIcon : OutlineIcon;
  return (
    <button
      type="button"
      data-print-hide="true"
      data-sidebar-edge={side}
      data-sidebar-edge-panel={panel}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`shrink-0 w-7 flex items-center justify-center ${borderClass} border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors cursor-pointer`}
      style={{ background: "var(--color-surface-secondary)" }}
    >
      <Icon />
    </button>
  );
}

export function Sidebar({
  side,
  activeTab,
  tocEntries,
  filesVisible,
  outlineVisible,
  sidebarLayout,
  swapSidebarSides,
  width,
  onToggleFiles,
  onToggleOutline,
  onToggleExpand,
  onOpenFileInTab,
  onOpenFileInNewTab,
}: SidebarProps) {
  const activeId = useActiveHeading(tocEntries);

  if (!activeTab) return null;
  const w = width ?? DEFAULT_WIDTH;
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
    <div className="px-3 pb-3">
      <PanelHeader
        label={folderName(folder.root)}
        side={headerSide}
        onCollapse={onToggleFiles}
        collapseTitle="Hide files sidebar"
      />
      <FileTree
        root={folder.root}
        nodes={folder.nodes}
        expanded={folder.expanded}
        activeFilePath={folder.file?.path}
        onToggle={(path) => onToggleExpand(folder.id, path)}
        onOpenFile={(path) => onOpenFileInTab(folder.id, path)}
        onOpenFileInNewTab={onOpenFileInNewTab}
      />
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
