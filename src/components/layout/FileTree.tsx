import { useCallback, useMemo, useState } from "react";
import type { DirEntry } from "@/hooks/useTabs";
import type { ContextMenuItem } from "@/lib/contextMenuItems";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";
import { FileTextIcon } from "../icons/FileTextIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { FolderOpenIcon } from "../icons/FolderOpenIcon";
import { ContextMenu, type ContextMenuModel } from "../menu/ContextMenu";
import { InlineRenameInput } from "./InlineRenameInput";

type CreateKind = "note" | "folder";

interface FileTreeProps {
  root: string;
  nodes: Map<string, DirEntry[]>;
  expanded: Set<string>;
  activeFilePath?: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  // Right-click "Open in New Tab" — pops the file out as a new top-level tab.
  onOpenFileInNewTab: (path: string) => void;
  // Create an untitled note/folder inside `dir`; resolves to the new path.
  onCreateNote: (dir: string) => Promise<string | null>;
  onCreateFolder: (dir: string) => Promise<string | null>;
  // Rename a just-created entry to the inline-typed name; resolves to the final path.
  onRename: (path: string, newName: string) => Promise<string | null>;
}

const INDENT_PX = 12;

interface ContextMenuState {
  x: number;
  y: number;
  dir: string;
  filePath?: string;
}

interface EditingState {
  path: string;
  kind: CreateKind;
}

const INPUT_CLASS =
  "w-full text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-text-primary)] outline-none";

type EntryRenderProps = Pick<
  FileTreeProps,
  "nodes" | "expanded" | "activeFilePath" | "onToggle" | "onOpenFile"
> & {
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  editing: EditingState | null;
  onEditCommit: (value: string) => void;
  onEditCancel: () => void;
};

/** Default inline-rename text: the file stem (no extension) or the folder name. */
function editInitialValue(entry: DirEntry, kind: CreateKind): string {
  return kind === "note" ? entry.name.replace(/\.[^.]+$/, "") : entry.name;
}

function renderEntry(entry: DirEntry, depth: number, props: EntryRenderProps): React.ReactNode {
  const { nodes, expanded, activeFilePath, onToggle, onOpenFile, onContextMenu, editing } = props;
  const indentStyle = { paddingLeft: `${depth * INDENT_PX + 8}px` };

  if (editing && editing.path === entry.path) {
    return (
      <li key={entry.path}>
        <InlineRenameInput
          initialValue={editInitialValue(entry, editing.kind)}
          onCommit={props.onEditCommit}
          onCancel={props.onEditCancel}
          className={INPUT_CLASS}
          style={indentStyle}
        />
      </li>
    );
  }

  if (entry.isDirectory) {
    const isExpanded = expanded.has(entry.path);
    const children = nodes.get(entry.path);
    return (
      <li key={entry.path}>
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          onContextMenu={(e) => onContextMenu(e, entry)}
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
        onContextMenu={(e) => onContextMenu(e, entry)}
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

/** Parent directory of a path, or `fallback` for a top-level entry. */
function parentDir(path: string, fallback: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep > 0 ? path.slice(0, sep) : fallback;
}

export function FileTree({
  root,
  nodes,
  expanded,
  activeFilePath,
  onToggle,
  onOpenFile,
  onOpenFileInNewTab,
  onCreateNote,
  onCreateFolder,
  onRename,
}: FileTreeProps) {
  const entries = nodes.get(root) ?? [];
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const closeMenu = useCallback(() => setContextMenu(null), []);

  const startCreate = useCallback(
    async (kind: CreateKind, dir: string) => {
      const path = kind === "note" ? await onCreateNote(dir) : await onCreateFolder(dir);
      if (path) setEditing({ path, kind });
    },
    [onCreateNote, onCreateFolder],
  );

  // Commit the inline name. An empty name keeps the collision-safe default
  // ("Untitled.md"); a note is opened either way so creation lands on content.
  const handleEditCommit = useCallback(
    async (value: string) => {
      // Defensive: commit only fires while a row is being edited.
      if (!editing) return;
      const { path, kind } = editing;
      setEditing(null);
      const name = value.trim();
      if (name) {
        const finalPath = await onRename(path, name);
        if (kind === "note") onOpenFile(finalPath ?? path);
      } else if (kind === "note") {
        onOpenFile(path);
      }
    },
    [editing, onRename, onOpenFile],
  );

  const handleEditCancel = useCallback(() => {
    // Defensive: cancel only fires while a row is being edited.
    if (!editing) return;
    const { path, kind } = editing;
    setEditing(null);
    if (kind === "note") onOpenFile(path);
  }, [editing, onOpenFile]);

  const handleEntryContextMenu = useCallback(
    (e: React.MouseEvent, entry: DirEntry) => {
      e.preventDefault();
      if (entry.isDirectory) {
        setContextMenu({ x: e.clientX, y: e.clientY, dir: entry.path });
      } else {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          dir: parentDir(entry.path, root),
          filePath: entry.path,
        });
      }
    },
    [root],
  );

  // Empty area below the entries: create at the workspace root. Entry rows
  // preventDefault first, so this only fires for genuinely empty space.
  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, dir: root });
    },
    [root],
  );

  const menu = useMemo<ContextMenuModel | null>(() => {
    if (!contextMenu) return null;
    const { x, y, dir, filePath } = contextMenu;
    const items: ContextMenuItem[] = [];
    if (filePath) {
      items.push({ kind: "action", label: "Open", onSelect: () => onOpenFile(filePath) });
      items.push({
        kind: "action",
        label: "Open in New Tab",
        onSelect: () => onOpenFileInNewTab(filePath),
      });
      items.push({ kind: "separator" });
    }
    items.push({ kind: "action", label: "New Note", onSelect: () => startCreate("note", dir) });
    items.push({ kind: "action", label: "New Folder", onSelect: () => startCreate("folder", dir) });
    return { x, y, items };
  }, [contextMenu, onOpenFile, onOpenFileInNewTab, startCreate]);

  const childProps: EntryRenderProps = {
    nodes,
    expanded,
    activeFilePath,
    onToggle,
    onOpenFile,
    onContextMenu: handleEntryContextMenu,
    editing,
    onEditCommit: handleEditCommit,
    onEditCancel: handleEditCancel,
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: container only suppresses the native menu for empty-area right-clicks; keyboard users create via the menu reached from focusable rows
    <div className="min-h-20" onContextMenu={handleRootContextMenu}>
      <ul className="space-y-0.5">{entries.map((entry) => renderEntry(entry, 0, childProps))}</ul>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
