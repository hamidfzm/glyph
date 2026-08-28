import type { DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isPathInside, parentDir } from "@/lib/paths";

/** Payload type marking an in-tree drag, so foreign HTML5 drags (links or
 *  images dragged out of the rendered document) can never match a drop. */
export const TREE_DRAG_TYPE = "application/x-glyph-tree-path";

const isTreeDrag = (event: DragEvent) => event.dataTransfer.types.includes(TREE_DRAG_TYPE);

/** Drag-source handlers for any tree row. */
export interface TreeDragHandlers {
  draggable: true;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}

/** Drop-target handlers for a folder row or the root area. */
export interface TreeDropHandlers {
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export interface FileTreeDragMove {
  /** Directory hovered by a valid drag, for the drop-target highlight. */
  dropTarget: string | null;
  dragHandlersFor: (path: string) => TreeDragHandlers;
  dropHandlersFor: (dir: string) => TreeDropHandlers;
}

/** File rows are not drop targets: swallow dragover so the root area beneath
 *  doesn't light up while the pointer is over a file. Without preventDefault
 *  the browser shows "no drop" and never fires drop on the row. */
export const blockDropHandlers = {
  onDragOver: (event: DragEvent) => event.stopPropagation(),
};

// Native HTML5 drag-and-drop for moving tree entries into folders, following
// the useTabDragReorder pattern: no dependency, works in every WebView. The
// dragged path lives in a ref (only the highlighted target needs renders) and
// the move commits through `onMoveEntry(from, toDir)` on drop. The backend
// re-validates every move; the rules here only shape the drag affordance.
export function useFileTreeDragMove(
  root: string,
  onMoveEntry: (from: string, toDir: string) => void,
): FileTreeDragMove {
  const dragged = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const reset = useCallback(() => {
    dragged.current = null;
    setDropTarget(null);
  }, []);

  useEffect(
    () => () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    },
    [reset],
  );

  // A drop into `dir` is rejected when it targets the dragged entry itself or
  // anywhere inside it, or the directory the entry already lives in (a no-op).
  const canDrop = useCallback(
    (dir: string) => {
      const from = dragged.current;
      if (!from || isPathInside(dir, from)) return false;
      return parentDir(from, root) !== dir;
    },
    [root],
  );

  const dragHandlersFor = useCallback(
    (path: string): TreeDragHandlers => ({
      draggable: true,
      onDragStart: (event) => {
        dragged.current = path;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(TREE_DRAG_TYPE, path);
        // WebKit refuses to start a drag with an empty payload.
        event.dataTransfer.setData("text/plain", path);
        // Chromium skips dragend when the drag source unmounts mid-drag (a
        // watcher refresh can delete the dragged row); window-level fallbacks
        // still reset then. Bubble phase, so row handlers run first; the
        // stable `reset` identity dedupes repeated registration.
        window.addEventListener("dragend", reset, { once: true });
        window.addEventListener("drop", reset, { once: true });
      },
      onDragEnd: reset,
    }),
    [reset],
  );

  const dropHandlersFor = useCallback(
    (dir: string): TreeDropHandlers => ({
      onDragOver: (event) => {
        // Rows sit inside the root drop zone; only the innermost target counts.
        event.stopPropagation();
        if (!isTreeDrag(event) || !canDrop(dir)) return;
        // preventDefault marks a valid target; without it drop never fires.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        // dragover fires on every pointer move; keep the same value while the
        // target is unchanged so React can bail out of re-rendering.
        setDropTarget((prev) => (prev === dir ? prev : dir));
      },
      onDragLeave: (event) => {
        // Entering the row's own icon/label children fires dragleave too;
        // only a genuine exit clears the highlight.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropTarget((prev) => (prev === dir ? null : prev));
      },
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        const from = dragged.current;
        const valid = isTreeDrag(event) && canDrop(dir);
        dragged.current = null;
        setDropTarget(null);
        if (from && valid) onMoveEntry(from, dir);
      },
    }),
    [canDrop, onMoveEntry],
  );

  return { dropTarget, dragHandlersFor, dropHandlersFor };
}
