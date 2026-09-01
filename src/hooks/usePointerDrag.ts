import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

/** Pointer movement (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 5;

export interface DragSourceHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onClickCapture: (event: ReactPointerEvent | ReactMouseEvent) => void;
}

interface UsePointerDragOptions<T, R> {
  ghostLabel: (payload: T) => string;
  /** Resolves the valid drop target under the pointer (null shows no-drop); the
   *  last result is what `onDrop` commits, so the drop matches the feedback. */
  onDragMove: (payload: T, x: number, y: number) => R | null;
  onDrop: (payload: T, target: R) => void;
  onReset: () => void;
}

interface UsePointerDrag<T> {
  pressHandlersFor: (payload: T) => DragSourceHandlers;
}

interface DragState<T, R> {
  payload: T;
  startX: number;
  startY: number;
  active: boolean;
  target: R | null;
}

// Pointer-event press-to-drag core shared by the file tree and the tab strip.
// HTML5 drag events are NOT used on purpose: Tauri's native drag-drop handler
// owns the OS drag loop (for dropping external files onto the window), and on
// Windows that swallows every in-page dragover/drop, so the HTML5 API can
// never work there. Pointer events stay inside the page. A press only becomes
// a drag past a small movement threshold, so plain clicks keep working;
// consumers hit-test targets via elementFromPoint in `onDragMove`, and the
// click synthesized after a completed drag is swallowed exactly once.
export function usePointerDrag<T, R>(options: UsePointerDragOptions<T, R>): UsePointerDrag<T> {
  // Latest callbacks behind a ref, so the window listeners mount once and
  // never go stale, whatever identity the consumer passes each render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const drag = useRef<DragState<T, R> | null>(null);
  const suppressClick = useRef(false);
  const ghost = useRef<HTMLDivElement | null>(null);

  // Mount-lifetime listeners: every handler early-returns while no drag is in
  // progress, which is cheaper and simpler than attach-on-press bookkeeping.
  useEffect(() => {
    const finishDrag = (commit: boolean) => {
      const dragged = drag.current;
      if (!dragged) return;
      drag.current = null;
      optionsRef.current.onReset();
      ghost.current?.remove();
      ghost.current = null;
      delete document.body.dataset.pointerDrag;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (!dragged.active) return;
      // The click synthesized after a completed drag must not activate/toggle.
      suppressClick.current = true;
      if (commit && dragged.target !== null) {
        optionsRef.current.onDrop(dragged.payload, dragged.target);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const dragged = drag.current;
      if (!dragged) return;
      if (!dragged.active) {
        const moved =
          Math.abs(event.clientX - dragged.startX) + Math.abs(event.clientY - dragged.startY);
        if (moved < DRAG_THRESHOLD_PX) return;
        dragged.active = true;
        // The body attribute lets the stylesheet force the drag cursor over
        // elements with their own `cursor`, and no text selection meanwhile.
        document.body.dataset.pointerDrag = "";
        document.body.style.userSelect = "none";
        // The floating label pill is the drag feedback (there is no native
        // ghost image without the HTML5 drag API); its stylesheet rule keeps
        // it pointer-events:none so elementFromPoint sees through it.
        const pill = document.createElement("div");
        pill.className = "drag-ghost";
        pill.textContent = optionsRef.current.ghostLabel(dragged.payload);
        document.body.appendChild(pill);
        ghost.current = pill;
      }
      dragged.target = optionsRef.current.onDragMove(dragged.payload, event.clientX, event.clientY);
      ghost.current?.style.setProperty(
        "transform",
        `translate(${event.clientX + 14}px, ${event.clientY + 10}px)`,
      );
      document.body.style.cursor = dragged.target === null ? "no-drop" : "grabbing";
    };
    const handlePointerUp = () => finishDrag(true);
    const handlePointerCancel = () => finishDrag(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishDrag(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      finishDrag(false);
    };
  }, []);

  const pressHandlersFor = (payload: T): DragSourceHandlers => ({
    onPointerDown: (event) => {
      // Touch keeps scrolling; mobile has its own interaction model.
      if (event.button !== 0 || event.pointerType === "touch") return;
      // Capture keeps pointerup (and the click to swallow) arriving on this
      // element even when the button is released outside the window.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      // A drag that ended off-element leaves the flag set with no click to
      // eat; a new press starts a fresh interaction.
      suppressClick.current = false;
      drag.current = {
        payload,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
      };
    },
    onClickCapture: (event) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { pressHandlersFor };
}
