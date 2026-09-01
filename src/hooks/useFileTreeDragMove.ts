import { useState } from "react";
import { basename, isPathInside, parentDir } from "@/lib/paths";
import { type DragSourceHandlers, usePointerDrag } from "./usePointerDrag";

export interface FileTreeDragMove {
  /** Directory hovered by a valid drag, for the drop-target highlight. */
  dropTarget: string | null;
  dragHandlersFor: (path: string) => DragSourceHandlers;
}

/** Resolve the drop directory under the pointer: the nearest marked ancestor
 *  of the hit element. Folder rows target themselves and file rows their
 *  containing folder (so most of the tree is a live target, as in comparable
 *  editors); the root zone only counts when the pointer is over genuinely
 *  empty space, not the gaps between rows. */
function dropDirAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const zone = hit.closest<HTMLElement>("[data-tree-drop-dir]");
  if (!zone) return null;
  if (zone.hasAttribute("data-filetree-root") && hit !== zone) return null;
  return zone.getAttribute("data-tree-drop-dir");
}

// A drop into `dir` is rejected when it targets the dragged entry itself or
// anywhere inside it, or the directory the entry already lives in (a no-op).
function canDrop(dir: string, from: string, root: string): boolean {
  if (isPathInside(dir, from)) return false;
  return parentDir(from, root) !== dir;
}

// Drag-and-drop for moving tree entries into folders, on the shared pointer
// drag core (see usePointerDrag for why HTML5 drag events cannot be used).
// Targets are hit-tested against the data-tree-drop-* markers; the move
// commits through `onMoveEntry(from, toDir)` on release. The backend
// re-validates every move; the rules here only shape the drag affordance.
export function useFileTreeDragMove(
  root: string,
  onMoveEntry: (from: string, toDir: string) => void,
): FileTreeDragMove {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const { pressHandlersFor } = usePointerDrag<string, string>({
    ghostLabel: basename,
    onDragMove: (path, x, y) => {
      const dir = dropDirAt(x, y);
      const next = dir !== null && canDrop(dir, path, root) ? dir : null;
      setDropTarget((prev) => (prev === next ? prev : next));
      return next;
    },
    onDrop: onMoveEntry,
    onReset: () => setDropTarget(null),
  });

  return { dropTarget, dragHandlersFor: pressHandlersFor };
}
