import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { CanvasIcon } from "@/components/icons/CanvasIcon";
import { NewCanvasIcon } from "@/components/icons/NewCanvasIcon";
import type { DirEntry } from "@/hooks/useTabs";
import { isCanvasFile } from "@/lib/canvasExtensions";
import type { ContextMenuItem } from "@/lib/contextMenuItems";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";
import { CopyPathIcon } from "../icons/CopyPathIcon";
import { DeleteIcon } from "../icons/DeleteIcon";
import { DuplicateIcon } from "../icons/DuplicateIcon";
import { FileTextIcon } from "../icons/FileTextIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { FolderOpenIcon } from "../icons/FolderOpenIcon";
import { MoveIcon } from "../icons/MoveIcon";
import { NewFolderIcon } from "../icons/NewFolderIcon";
import { NewNoteIcon } from "../icons/NewNoteIcon";
import { NewTabIcon } from "../icons/NewTabIcon";
import { OpenIcon } from "../icons/OpenIcon";
import { RenameIcon } from "../icons/RenameIcon";
import { RevealIcon } from "../icons/RevealIcon";
import { ContextMenu, type ContextMenuModel } from "../menu/ContextMenu";
import { InlineRenameInput } from "./InlineRenameInput";

type CreateKind = "note" | "canvas" | "folder";

interface FileTreeProps {
  root: string;
  nodes: Map<string, DirEntry[]>;
  expanded: Set<string>;
  activeFilePath?: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  // Right-click "Open in New Tab" — pops the file out as a new top-level tab.
  onOpenFileInNewTab: (path: string) => void;
  // Create an untitled note/canvas/folder inside `dir`; resolves to the new path.
  onCreateNote: (dir: string) => Promise<string | null>;
  onCreateCanvas: (dir: string) => Promise<string | null>;
  onCreateFolder: (dir: string) => Promise<string | null>;
  // Rename an entry to the inline-typed name; resolves to the final path.
  onRename: (path: string, newName: string) => Promise<string | null>;
  // Duplicate an entry next to itself; resolves to the new path.
  onDuplicate: (path: string) => Promise<string | null>;
  // Move an entry: prompt for a destination folder, then relocate it.
  onMove: (path: string) => void;
  // Reveal an entry in the OS file manager.
  onReveal: (path: string) => void;
  // Delete a note/folder (confirms first); resolves true when removed.
  onDelete: (path: string) => Promise<boolean>;
}

/** Imperative handle so the panel toolbar can create at the workspace root. */
export interface FileTreeHandle {
  createNote: () => void;
  createFolder: () => void;
}

const INDENT_PX = 12;

interface ContextMenuState {
  x: number;
  y: number;
  dir: string;
  filePath?: string;
  entryPath?: string;
  entryIsDir?: boolean;
}

interface EditingState {
  path: string;
  kind: CreateKind;
  // Open the note after naming. True for fresh creates, false for renames
  // (renaming the open file is handled by re-pointing the existing tab).
  openOnCommit: boolean;
}

const INPUT_CLASS =
  "w-full text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-text-primary)] outline-none";

type EntryRenderProps = Pick<
  FileTreeProps,
  "nodes" | "expanded" | "activeFilePath" | "onToggle" | "onOpenFile"
> & {
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  editing: EditingState | null;
  onEditCommit: (editing: EditingState, value: string) => void;
  onEditCancel: (editing: EditingState) => void;
};

/** Default inline-rename text: the file stem (no extension) or the folder name. */
function editInitialValue(entry: DirEntry, kind: CreateKind): string {
  return kind === "folder" ? entry.name : entry.name.replace(/\.[^.]+$/, "");
}

function renderEntry(entry: DirEntry, depth: number, props: EntryRenderProps): React.ReactNode {
  const { nodes, expanded, activeFilePath, onToggle, onOpenFile, onContextMenu, editing } = props;
  const indentStyle = { paddingLeft: `${depth * INDENT_PX + 8}px` };

  if (editing && editing.path === entry.path) {
    return (
      <li key={entry.path}>
        <InlineRenameInput
          initialValue={editInitialValue(entry, editing.kind)}
          onCommit={(value) => props.onEditCommit(editing, value)}
          onCancel={() => props.onEditCancel(editing)}
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
        {isCanvasFile(entry.name) ? (
          <CanvasIcon className={isActive ? "opacity-90" : "opacity-60"} />
        ) : (
          <FileTextIcon className={isActive ? "opacity-90" : "opacity-60"} />
        )}
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

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  {
    root,
    nodes,
    expanded,
    activeFilePath,
    onToggle,
    onOpenFile,
    onOpenFileInNewTab,
    onCreateNote,
    onCreateCanvas,
    onCreateFolder,
    onRename,
    onDuplicate,
    onMove,
    onReveal,
    onDelete,
  },
  ref,
) {
  const entries = nodes.get(root) ?? [];
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const closeMenu = useCallback(() => setContextMenu(null), []);

  // Enter inline-naming for a freshly-created entry (null = creation failed).
  const beginNaming = useCallback((path: string | null, kind: CreateKind) => {
    if (path) setEditing({ path, kind, openOnCommit: true });
  }, []);

  const startCreate = useCallback(
    async (kind: CreateKind, dir: string) => {
      const create =
        kind === "note" ? onCreateNote : kind === "canvas" ? onCreateCanvas : onCreateFolder;
      beginNaming(await create(dir), kind);
    },
    [onCreateNote, onCreateCanvas, onCreateFolder, beginNaming],
  );

  useImperativeHandle(
    ref,
    () => ({
      createNote: () => startCreate("note", root),
      createFolder: () => startCreate("folder", root),
    }),
    [startCreate, root],
  );

  const startRename = useCallback((path: string, isDir: boolean) => {
    setEditing({ path, kind: isDir ? "folder" : "note", openOnCommit: false });
  }, []);

  // Copy the entry's path: relative to the workspace root, or absolute.
  const copyPath = useCallback(
    (path: string, absolute: boolean) => {
      const relative = path.startsWith(root)
        ? path.slice(root.length).replace(/^[\\/]+/, "")
        : path;
      void navigator.clipboard.writeText(absolute ? path : relative).catch(() => undefined);
    },
    [root],
  );

  // Commit the inline name. An empty name keeps the collision-safe default
  // ("Untitled.md"); a freshly-created note is opened so creation lands on
  // content (renames don't re-open; the open tab is re-pointed instead).
  const handleEditCommit = useCallback(
    async ({ path, kind, openOnCommit }: EditingState, value: string) => {
      setEditing(null);
      const name = value.trim();
      if (name) {
        const finalPath = await onRename(path, name);
        if (kind !== "folder" && openOnCommit) onOpenFile(finalPath ?? path);
      } else if (kind !== "folder" && openOnCommit) {
        onOpenFile(path);
      }
    },
    [onRename, onOpenFile],
  );

  const handleEditCancel = useCallback(
    ({ path, kind, openOnCommit }: EditingState) => {
      setEditing(null);
      if (kind !== "folder" && openOnCommit) onOpenFile(path);
    },
    [onOpenFile],
  );

  const handleEntryContextMenu = useCallback(
    (e: React.MouseEvent, entry: DirEntry) => {
      e.preventDefault();
      if (entry.isDirectory) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          dir: entry.path,
          entryPath: entry.path,
          entryIsDir: true,
        });
      } else {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          dir: parentDir(entry.path, root),
          filePath: entry.path,
          entryPath: entry.path,
          entryIsDir: false,
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
    const { x, y, dir, filePath, entryPath, entryIsDir } = contextMenu;
    const groups: ContextMenuItem[][] = [];

    if (filePath) {
      groups.push([
        { kind: "action", label: "Open", icon: <OpenIcon />, onSelect: () => onOpenFile(filePath) },
        {
          kind: "action",
          label: "Open in New Tab",
          icon: <NewTabIcon />,
          onSelect: () => onOpenFileInNewTab(filePath),
        },
      ]);
    }

    groups.push([
      {
        kind: "action",
        label: "New Note",
        icon: <NewNoteIcon />,
        onSelect: () => startCreate("note", dir),
      },
      {
        kind: "action",
        label: "New Canvas",
        icon: <NewCanvasIcon />,
        onSelect: () => startCreate("canvas", dir),
      },
      {
        kind: "action",
        label: "New Folder",
        icon: <NewFolderIcon />,
        onSelect: () => startCreate("folder", dir),
      },
    ]);

    if (entryPath) {
      groups.push([
        {
          kind: "action",
          label: "Rename",
          icon: <RenameIcon />,
          onSelect: () => startRename(entryPath, !!entryIsDir),
        },
        {
          kind: "action",
          label: "Make a copy",
          icon: <DuplicateIcon />,
          onSelect: () => onDuplicate(entryPath),
        },
        {
          kind: "action",
          label: "Move to…",
          icon: <MoveIcon />,
          onSelect: () => onMove(entryPath),
        },
      ]);
      groups.push([
        {
          kind: "action",
          label: "Copy path",
          icon: <CopyPathIcon />,
          onSelect: () => copyPath(entryPath, false),
        },
        {
          kind: "action",
          label: "Copy absolute path",
          icon: <CopyPathIcon />,
          onSelect: () => copyPath(entryPath, true),
        },
        {
          kind: "action",
          label: "Show in system explorer",
          icon: <RevealIcon />,
          onSelect: () => onReveal(entryPath),
        },
      ]);
      groups.push([
        {
          kind: "action",
          label: "Delete",
          icon: <DeleteIcon />,
          danger: true,
          onSelect: () => onDelete(entryPath),
        },
      ]);
    }

    const items: ContextMenuItem[] = [];
    for (const group of groups) {
      if (items.length > 0) items.push({ kind: "separator" });
      items.push(...group);
    }
    return { x, y, items };
  }, [
    contextMenu,
    onOpenFile,
    onOpenFileInNewTab,
    onDelete,
    onDuplicate,
    onMove,
    onReveal,
    startCreate,
    startRename,
    copyPath,
  ]);

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
    <div data-filetree-root className="min-h-20 flex-1" onContextMenu={handleRootContextMenu}>
      <ul className="space-y-0.5">{entries.map((entry) => renderEntry(entry, 0, childProps))}</ul>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
});
