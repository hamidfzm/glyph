import type { DragEvent } from "react";
import { useCallback, useRef, useState } from "react";

/** Insertion marker while a tab drag is in progress: the hovered tab's index
 *  and which edge of it the dragged tab would land on. */
export interface TabDropIndicator {
  index: number;
  edge: "before" | "after";
}

export interface TabDragHandlers {
  draggable: true;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
}

interface UseTabDragReorder {
  indicator: TabDropIndicator | null;
  handlersFor: (id: string, index: number) => TabDragHandlers;
}

// Native HTML5 drag-and-drop reordering for the tab strip: no dependency, works
// in every WebView. Tracks the dragged tab in a ref (only the indicator needs
// renders) and commits the reorder through `onMove(id, toIndex)` on drop.
// Dropping on a tab moves the dragged tab to that tab's index, so the edge the
// indicator shows follows the drag direction: dragging right lands after the
// hovered tab, dragging left lands before it (splice semantics).
export function useTabDragReorder(
  onMove: (id: string, toIndex: number) => void,
): UseTabDragReorder {
  const drag = useRef<{ id: string; index: number } | null>(null);
  const [indicator, setIndicator] = useState<TabDropIndicator | null>(null);

  const handlersFor = useCallback(
    (id: string, index: number): TabDragHandlers => ({
      draggable: true,
      onDragStart: (event) => {
        drag.current = { id, index };
        event.dataTransfer.effectAllowed = "move";
        // WebKit refuses to start a drag with an empty payload.
        event.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (event) => {
        const dragged = drag.current;
        if (!dragged) return;
        // preventDefault marks the tab as a valid drop target; without it the
        // drop event never fires.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const next: TabDropIndicator | null =
          index === dragged.index
            ? null
            : { index, edge: index > dragged.index ? "after" : "before" };
        // dragover fires on every pointer move; keep the same object while the
        // target is unchanged so React can bail out of re-rendering.
        setIndicator((prev) =>
          prev?.index === next?.index && prev?.edge === next?.edge ? prev : next,
        );
      },
      onDrop: (event) => {
        event.preventDefault();
        const dragged = drag.current;
        if (dragged && dragged.id !== id) onMove(dragged.id, index);
        drag.current = null;
        setIndicator(null);
      },
      onDragEnd: () => {
        drag.current = null;
        setIndicator(null);
      },
    }),
    [onMove],
  );

  return { indicator, handlersFor };
}
