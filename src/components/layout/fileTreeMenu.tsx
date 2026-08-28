import type { TFunction } from "i18next";
import { CopyPathIcon } from "@/components/icons/CopyPathIcon";
import { DeleteIcon } from "@/components/icons/DeleteIcon";
import { DuplicateIcon } from "@/components/icons/DuplicateIcon";
import { MoveIcon } from "@/components/icons/MoveIcon";
import { NewCanvasIcon } from "@/components/icons/NewCanvasIcon";
import { NewFolderIcon } from "@/components/icons/NewFolderIcon";
import { NewNoteIcon } from "@/components/icons/NewNoteIcon";
import { NewWindowIcon } from "@/components/icons/NewWindowIcon";
import { OpenIcon } from "@/components/icons/OpenIcon";
import { RenameIcon } from "@/components/icons/RenameIcon";
import { RevealIcon } from "@/components/icons/RevealIcon";
import type { ContextMenuModel } from "@/components/menu/ContextMenu";
import { type ContextMenuItem, joinGroups } from "@/lib/contextMenuItems";
import { isMobilePlatform } from "@/lib/platform";
import type { EntryEditKind } from "./FileTreeEntry";

export interface FileTreeMenuTarget {
  x: number;
  y: number;
  dir: string;
  filePath?: string;
  entryPath?: string;
  entryIsDir?: boolean;
}

interface FileTreeMenuActions {
  onOpenFile: (path: string) => void;
  onOpenInNewWindow: (path: string) => void;
  onCreate: (kind: EntryEditKind, dir: string) => void;
  onStartRename: (path: string, isDir: boolean) => void;
  onDuplicate: (path: string) => void;
  onMove: (path: string) => void;
  onCopyPath: (path: string, absolute: boolean) => void;
  onReveal: (path: string) => void;
  onDelete: (path: string) => void;
}

/** Build the workspace-tree context menu for a right-clicked entry, or for the
 *  empty area below the tree (no `entryPath`, so only the create group shows). */
export function buildFileTreeMenu(
  target: FileTreeMenuTarget,
  actions: FileTreeMenuActions,
  t: TFunction<"common">,
): ContextMenuModel {
  const { x, y, dir, filePath, entryPath, entryIsDir } = target;
  const groups: ContextMenuItem[][] = [];

  if (filePath) {
    const open: ContextMenuItem[] = [
      {
        kind: "action",
        label: t("fileTree.open"),
        icon: <OpenIcon />,
        onSelect: () => actions.onOpenFile(filePath),
      },
    ];
    // Desktop only: mobile has no second window to open into.
    if (!isMobilePlatform()) {
      open.push({
        kind: "action",
        label: t("fileTree.openInNewWindow"),
        icon: <NewWindowIcon />,
        onSelect: () => actions.onOpenInNewWindow(filePath),
      });
    }
    groups.push(open);
  }

  groups.push([
    {
      kind: "action",
      label: t("fileTree.newNote"),
      icon: <NewNoteIcon />,
      onSelect: () => actions.onCreate("note", dir),
    },
    {
      kind: "action",
      label: t("fileTree.newCanvas"),
      icon: <NewCanvasIcon />,
      onSelect: () => actions.onCreate("canvas", dir),
    },
    {
      kind: "action",
      label: t("fileTree.newFolder"),
      icon: <NewFolderIcon />,
      onSelect: () => actions.onCreate("folder", dir),
    },
  ]);

  if (entryPath) {
    groups.push([
      {
        kind: "action",
        label: t("fileTree.rename"),
        icon: <RenameIcon />,
        onSelect: () => actions.onStartRename(entryPath, !!entryIsDir),
      },
      {
        kind: "action",
        label: t("fileTree.duplicate"),
        icon: <DuplicateIcon />,
        onSelect: () => actions.onDuplicate(entryPath),
      },
      {
        kind: "action",
        label: t("fileTree.move"),
        icon: <MoveIcon />,
        onSelect: () => actions.onMove(entryPath),
      },
    ]);
    groups.push([
      {
        kind: "action",
        label: t("fileTree.copyPath"),
        icon: <CopyPathIcon />,
        onSelect: () => actions.onCopyPath(entryPath, false),
      },
      {
        kind: "action",
        label: t("fileTree.copyAbsolutePath"),
        icon: <CopyPathIcon />,
        onSelect: () => actions.onCopyPath(entryPath, true),
      },
      {
        kind: "action",
        label: t("fileTree.reveal"),
        icon: <RevealIcon />,
        onSelect: () => actions.onReveal(entryPath),
      },
    ]);
    groups.push([
      {
        kind: "action",
        label: t("fileTree.delete"),
        icon: <DeleteIcon />,
        danger: true,
        onSelect: () => actions.onDelete(entryPath),
      },
    ]);
  }

  return { x, y, items: joinGroups(groups) };
}
