import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuModel } from "@/components/menu/ContextMenu";
import { parentDir } from "@/lib/paths";
import type { DirEntry } from "@/lib/tabs";
import {
  type EntryEditingState,
  type EntryEditKind,
  FileTreeEntry,
  type FileTreeEntryProps,
} from "./FileTreeEntry";
import { buildFileTreeMenu, type FileTreeMenuTarget } from "./fileTreeMenu";

interface FileTreeProps {
  root: string;
  nodes: Map<string, DirEntry[]>;
  expanded: Set<string>;
  activeFilePath?: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
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

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  {
    root,
    nodes,
    expanded,
    activeFilePath,
    onToggle,
    onOpenFile,
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
  const { t } = useTranslation("common");
  const entries = nodes.get(root) ?? [];
  const [contextMenu, setContextMenu] = useState<FileTreeMenuTarget | null>(null);
  const [editing, setEditing] = useState<EntryEditingState | null>(null);
  const closeMenu = useCallback(() => setContextMenu(null), []);

  // Enter inline-naming for a freshly-created entry (null = creation failed).
  const beginNaming = useCallback((path: string | null, kind: EntryEditKind) => {
    if (path) setEditing({ path, kind, openOnCommit: true });
  }, []);

  const startCreate = useCallback(
    async (kind: EntryEditKind, dir: string) => {
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
    async ({ path, kind, openOnCommit }: EntryEditingState, value: string) => {
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
    ({ path, kind, openOnCommit }: EntryEditingState) => {
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
    return buildFileTreeMenu(
      contextMenu,
      {
        onOpenFile,
        onCreate: startCreate,
        onStartRename: startRename,
        onDuplicate,
        onMove,
        onCopyPath: copyPath,
        onReveal,
        onDelete,
      },
      t,
    );
  }, [
    contextMenu,
    onOpenFile,
    onDelete,
    onDuplicate,
    onMove,
    onReveal,
    startCreate,
    startRename,
    copyPath,
    t,
  ]);

  const childProps: Omit<FileTreeEntryProps, "entry" | "depth"> = {
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
    <div data-filetree-root className="min-h-full" onContextMenu={handleRootContextMenu}>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <FileTreeEntry key={entry.path} {...childProps} entry={entry} depth={0} />
        ))}
      </ul>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
});
