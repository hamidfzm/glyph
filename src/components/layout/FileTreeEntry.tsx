import { CanvasIcon } from "@/components/icons/CanvasIcon";
import { ChevronRightIcon } from "@/components/icons/ChevronRightIcon";
import { FileTextIcon } from "@/components/icons/FileTextIcon";
import { FolderIcon } from "@/components/icons/FolderIcon";
import { FolderOpenIcon } from "@/components/icons/FolderOpenIcon";
import { ImageIcon } from "@/components/icons/ImageIcon";
import { InlineRenameInput } from "@/components/layout/InlineRenameInput";
import type { FileTreeDragMove } from "@/hooks/useFileTreeDragMove";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { isImageFile } from "@/lib/imageExtensions";
import { stem } from "@/lib/paths";
import type { DirEntry } from "@/lib/tabs";

const INDENT_PX = 12;

const INPUT_CLASS =
  "w-full text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-text-primary)] outline-none";

export type EntryEditKind = "note" | "canvas" | "folder";

export interface EntryEditingState {
  path: string;
  kind: EntryEditKind;
  // Open the note after naming. True for fresh creates, false for renames
  // (renaming the open file is handled by re-pointing the existing tab).
  openOnCommit: boolean;
}

export interface FileTreeEntryProps {
  entry: DirEntry;
  depth: number;
  nodes: Map<string, DirEntry[]>;
  expanded: Set<string>;
  activeFilePath?: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  editing: EntryEditingState | null;
  onEditCommit: (editing: EntryEditingState, value: string) => void;
  onEditCancel: (editing: EntryEditingState) => void;
  dnd: FileTreeDragMove;
}

/** One row of the workspace tree: a file button, or a folder button plus its
 *  expanded children. Recurses into itself for subdirectories. */
export function FileTreeEntry(props: FileTreeEntryProps) {
  const { entry, depth, nodes, expanded, activeFilePath, onToggle, onOpenFile, editing, dnd } =
    props;
  const indentStyle = { paddingLeft: `${depth * INDENT_PX + 8}px` };

  if (editing && editing.path === entry.path) {
    return (
      <li>
        <InlineRenameInput
          // Default inline-rename text: the file stem, or the folder name as-is.
          initialValue={editing.kind === "folder" ? entry.name : stem(entry.name)}
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
    const isDropTarget = dnd.dropTarget === entry.path;
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          onContextMenu={(e) => props.onContextMenu(e, entry)}
          {...dnd.dragHandlersFor(entry.path)}
          data-tree-drop-dir={entry.path}
          data-drop-target={isDropTarget || undefined}
          className={`w-full text-start text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] active:bg-[var(--color-border)] flex items-center gap-1.5 ${
            isDropTarget
              ? "bg-[var(--color-surface-tertiary)] ring-1 ring-inset ring-[var(--color-accent)]"
              : ""
          }`}
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
          <ul>
            {children.map((child) => (
              <FileTreeEntry key={child.path} {...props} entry={child} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isActive = activeFilePath === entry.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenFile(entry.path)}
        onContextMenu={(e) => props.onContextMenu(e, entry)}
        {...dnd.dragHandlersFor(entry.path)}
        data-tree-drop-block=""
        className={`w-full text-start text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors flex items-center gap-1.5 ${
          isActive
            ? "bg-[var(--color-accent)] text-white font-medium"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] active:bg-[var(--color-border)]"
        }`}
        style={indentStyle}
        title={entry.path}
      >
        <span className="w-[10px]" aria-hidden="true" />
        {isCanvasFile(entry.name) ? (
          <CanvasIcon className={isActive ? "opacity-90" : "opacity-60"} />
        ) : isImageFile(entry.name) ? (
          <ImageIcon className={isActive ? "opacity-90" : "opacity-60"} />
        ) : (
          <FileTextIcon className={isActive ? "opacity-90" : "opacity-60"} />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
    </li>
  );
}
