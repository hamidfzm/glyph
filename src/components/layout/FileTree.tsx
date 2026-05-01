import { useEffect, useState } from "react";
import type { DirEntry } from "../../hooks/useTabs";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";
import { FileTextIcon } from "../icons/FileTextIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { FolderOpenIcon } from "../icons/FolderOpenIcon";

interface FileTreeProps {
  root: string;
  nodes: Map<string, DirEntry[]>;
  expanded: Set<string>;
  activeFilePath?: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  // Right-click "Open in New Tab" — pops the file out as a new top-level tab.
  onOpenFileInNewTab: (path: string) => void;
}

const INDENT_PX = 12;

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

type EntryRenderProps = Pick<
  FileTreeProps,
  "nodes" | "expanded" | "activeFilePath" | "onToggle" | "onOpenFile"
> & {
  onContextMenu: (e: React.MouseEvent, path: string) => void;
};

function renderEntry(entry: DirEntry, depth: number, props: EntryRenderProps): React.ReactNode {
  const { nodes, expanded, activeFilePath, onToggle, onOpenFile, onContextMenu } = props;
  const indentStyle = { paddingLeft: `${depth * INDENT_PX + 8}px` };

  if (entry.isDirectory) {
    const isExpanded = expanded.has(entry.path);
    const children = nodes.get(entry.path);
    return (
      <li key={entry.path}>
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          className="w-full text-left text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] flex items-center gap-1.5"
          style={indentStyle}
          title={entry.path}
        >
          <ChevronRightIcon expanded={isExpanded} />
          {isExpanded ? (
            <FolderOpenIcon className="opacity-70" />
          ) : (
            <FolderIcon className="opacity-70" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {isExpanded && children && (
          <ul>{children.map((child) => renderEntry(child, depth + 1, props))}</ul>
        )}
      </li>
    );
  }

  const isActive = activeFilePath === entry.path;
  return (
    <li key={entry.path}>
      <button
        type="button"
        onClick={() => onOpenFile(entry.path)}
        onContextMenu={(e) => onContextMenu(e, entry.path)}
        className={`w-full text-left text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors flex items-center gap-1.5 ${
          isActive
            ? "bg-[var(--color-accent)] text-white font-medium"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
        }`}
        style={indentStyle}
        title={entry.path}
      >
        <span className="w-[10px]" aria-hidden="true" />
        <FileTextIcon className={isActive ? "opacity-90" : "opacity-60"} />
        <span className="truncate">{entry.name}</span>
      </button>
    </li>
  );
}

export function FileTree({
  root,
  nodes,
  expanded,
  activeFilePath,
  onToggle,
  onOpenFile,
  onOpenFileInNewTab,
}: FileTreeProps) {
  const entries = nodes.get(root) ?? [];
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  // Dismiss the context menu on any outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const childProps: EntryRenderProps = {
    nodes,
    expanded,
    activeFilePath,
    onToggle,
    onOpenFile,
    onContextMenu: handleContextMenu,
  };

  return (
    <div>
      <ul className="space-y-0.5">{entries.map((entry) => renderEntry(entry, 0, childProps))}</ul>

      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-40 py-1 rounded-[var(--glyph-radius)] border border-[var(--color-border)] shadow-lg text-sm"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--color-surface)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFileInNewTab(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Open in New Tab
          </button>
        </div>
      )}
    </div>
  );
}
