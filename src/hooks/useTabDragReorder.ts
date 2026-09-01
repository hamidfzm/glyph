import { useState } from "react";
import { type DragSourceHandlers, usePointerDrag } from "./usePointerDrag";

/** Insertion marker while a tab drag is in progress: the hovered tab's index
 *  and which edge of it the dragged tab would land on. */
export interface TabDropIndicator {
  index: number;
  edge: "before" | "after";
}

interface TabDragPayload {
  id: string;
  index: number;
  label: string;
}

interface UseTabDragReorder {
  indicator: TabDropIndicator | null;
  handlersFor: (id: string, index: number, label: string) => DragSourceHandlers;
}

/** Resolve the tab under the pointer via the `data-tab-index` markers on the
 *  tab elements (hits inside a tab, like its close button, resolve to it). */
function tabIndexAt(x: number, y: number): number | null {
  const tab = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab-index]");
  const index = tab?.getAttribute("data-tab-index");
  return index == null ? null : Number(index);
}

function indicatorFor(tab: TabDragPayload, hovered: number | null): TabDropIndicator | null {
  if (hovered === null || hovered === tab.index) return null;
  return { index: hovered, edge: hovered > tab.index ? "after" : "before" };
}

// Reordering for the tab strip, on the shared pointer drag core (see
// usePointerDrag for why HTML5 drag events cannot be used). Dropping on a tab
// moves the dragged tab to that tab's index through `onMove(id, toIndex)`
// (splice semantics), so the edge the indicator shows follows the drag
// direction: dragging right lands after the hovered tab, dragging left lands
// before it.
export function useTabDragReorder(
  onMove: (id: string, toIndex: number) => void,
): UseTabDragReorder {
  const [indicator, setIndicator] = useState<TabDropIndicator | null>(null);

  const { pressHandlersFor } = usePointerDrag<TabDragPayload, number>({
    ghostLabel: (tab) => tab.label,
    onDragMove: (tab, x, y) => {
      const next = indicatorFor(tab, tabIndexAt(x, y));
      // pointermove fires continuously; keep the same object while the target
      // is unchanged so React can bail out of re-rendering.
      setIndicator((prev) => {
        const unchanged = prev?.index === next?.index && prev?.edge === next?.edge;
        return unchanged ? prev : next;
      });
      return next?.index ?? null;
    },
    onDrop: (tab, index) => onMove(tab.id, index),
    onReset: () => setIndicator(null),
  });

  return {
    indicator,
    handlersFor: (id, index, label) => pressHandlersFor({ id, index, label }),
  };
}
