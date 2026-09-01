import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { basename, isPathInside, parentDir } from "@/lib/paths";

/** Pointer movement (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 5;

/** Drag-source handlers for any tree row. */
export interface TreeDragHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onClickCapture: (event: ReactPointerEvent | React.MouseEvent) => void;
}

export interface FileTreeDragMove {
  /** Directory hovered by a valid drag, for the drop-target highlight. */
  dropTarget: string | null;
  dragHandlersFor: (path: string) => TreeDragHandlers;
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

// Pointer-event drag-and-drop for moving tree entries into folders. HTML5
// drag events are NOT used on purpose: Tauri's native drag-drop handler owns
// the OS drag loop (for dropping external files onto the window), and on
// Windows that swallows every in-page dragover/drop, so the HTML5 API can
// never work there. Pointer events stay inside the page. A press only becomes
// a drag past a small movement threshold, so row clicks keep working; targets
// are hit-tested via elementFromPoint against data-tree-drop-* markers; the
// move commits through `onMoveEntry(from, toDir)` on release. The backend
// re-validates every move; the rules here only shape the drag affordance.
export function useFileTreeDragMove(
  root: string,
  onMoveEntry: (from: string, toDir: string) => void,
): FileTreeDragMove {
  const drag = useRef<{ path: string; startX: number; startY: number; active: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const ghost = useRef<HTMLDivElement | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // A drop into `dir` is rejected when it targets the dragged entry itself or
  // anywhere inside it, or the directory the entry already lives in (a no-op).
  const canDrop = useCallback(
    (dir: string, from: string) => {
      if (isPathInside(dir, from)) return false;
      return parentDir(from, root) !== dir;
    },
    [root],
  );

  const finishDrag = useCallback(
    (commitAt?: { x: number; y: number }) => {
      const dragged = drag.current;
      if (!dragged) return;
      drag.current = null;
      setDropTarget(null);
      ghost.current?.remove();
      ghost.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (!dragged.active) return;
      // The click synthesized after a completed drag must not open/toggle.
      suppressClick.current = true;
      if (!commitAt) return;
      const dir = dropDirAt(commitAt.x, commitAt.y);
      if (dir !== null && canDrop(dir, dragged.path)) onMoveEntry(dragged.path, dir);
    },
    [canDrop, onMoveEntry],
  );

  const handleWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const dragged = drag.current;
      if (!dragged) return;
      if (!dragged.active) {
        const moved =
          Math.abs(event.clientX - dragged.startX) + Math.abs(event.clientY - dragged.startY);
        if (moved < DRAG_THRESHOLD_PX) return;
        dragged.active = true;
        // No text selection while dragging; the cursor signals the mode.
        document.body.style.userSelect = "none";
        // The floating name pill is the drag feedback (there is no native
        // ghost image without the HTML5 drag API). pointer-events:none keeps
        // it invisible to the elementFromPoint hit-testing underneath it.
        const pill = document.createElement("div");
        pill.dataset.treeDragGhost = "";
        pill.style.cssText =
          "position:fixed;left:0;top:0;z-index:9999;pointer-events:none;" +
          "padding:2px 8px;border-radius:var(--glyph-radius-sm);font-size:12px;" +
          "background:var(--color-surface);border:1px solid var(--color-accent);" +
          "color:var(--color-text-primary);box-shadow:0 2px 8px rgb(0 0 0 / 0.25);" +
          "max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        pill.textContent = basename(dragged.path);
        document.body.appendChild(pill);
        ghost.current = pill;
      }
      const dir = dropDirAt(event.clientX, event.clientY);
      const valid = dir !== null && canDrop(dir, dragged.path);
      ghost.current?.style.setProperty(
        "transform",
        `translate(${event.clientX + 14}px, ${event.clientY + 10}px)`,
      );
      document.body.style.cursor = valid ? "grabbing" : "no-drop";
      const next = valid ? dir : null;
      setDropTarget((prev) => (prev === next ? prev : next));
    },
    [canDrop],
  );

  const handleWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      finishDrag({ x: event.clientX, y: event.clientY });
    },
    [finishDrag],
  );

  const handleWindowKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") finishDrag();
    },
    [finishDrag],
  );

  // Mount-lifetime listeners: every handler early-returns while no drag is in
  // progress, which is cheaper and simpler than attach-on-press bookkeeping.
  useEffect(() => {
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("keydown", handleWindowKeyDown);
      ghost.current?.remove();
      ghost.current = null;
    };
  }, [handleWindowPointerMove, handleWindowPointerUp, handleWindowKeyDown]);

  const dragHandlersFor = useCallback(
    (path: string): TreeDragHandlers => ({
      onPointerDown: (event) => {
        // Touch keeps scrolling the tree; mobile moves files via the menu.
        if (event.button !== 0 || event.pointerType === "touch") return;
        // A drag that ended off-row leaves the flag set with no click to eat;
        // a new press starts a fresh interaction.
        suppressClick.current = false;
        drag.current = { path, startX: event.clientX, startY: event.clientY, active: false };
      },
      onClickCapture: (event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [],
  );

  return { dropTarget, dragHandlersFor };
}
