import { useCallback, useRef, useState } from "react";

// Pixels per arrow-key press when the handle has keyboard focus.
const KEYBOARD_STEP = 16;

export interface PanelResizeOptions {
  // Persisted size. Pass a getter when the idle size is measured from the DOM
  // (e.g. an auto-height block); it is resolved at drag start.
  size: number | (() => number);
  min: number;
  // Upper bound; a getter is resolved at drag start (e.g. a fraction of the
  // window or the current container size).
  max: number | (() => number);
  // +1 when dragging toward positive client coordinates (right/down) grows the
  // panel, -1 when it shrinks it. A getter is resolved at drag start so RTL or
  // side swaps are picked up without re-binding.
  direction: 1 | -1 | (() => 1 | -1);
  axis: "x" | "y";
  // Called once, on release. Live updates stay local so a drag doesn't
  // re-render every settings consumer per pointermove.
  onCommit: (size: number) => void;
  // Called on double-click; restores the panel's default size.
  onReset: () => void;
}

interface DragState {
  start: number;
  size: number;
  direction: 1 | -1;
  max: number;
}

export interface PanelResizeHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Drag-to-resize for a panel edge. Spread `handleProps` onto a ResizeHandle;
 * apply `size` (live drag value, or the persisted size when idle; null when
 * the idle size is DOM-measured) as the panel's width/height style.
 */
export function usePanelResize(options: PanelResizeOptions): {
  size: number | null;
  dragging: boolean;
  handleProps: PanelResizeHandleProps;
} {
  const [live, setLive] = useState<number | null>(null);
  // Mirror of `live` readable from event handlers without going through a
  // state updater (committing inside an updater would double-fire in
  // StrictMode).
  const liveRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dragRef = useRef<DragState | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const o = optionsRef.current;
    const size = typeof o.size === "function" ? o.size() : o.size;
    dragRef.current = {
      start: o.axis === "x" ? e.clientX : e.clientY,
      size,
      direction: typeof o.direction === "function" ? o.direction() : o.direction,
      max: typeof o.max === "function" ? o.max() : o.max,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Suppress text selection and keep the resize cursor while the pointer
    // roams outside the thin handle.
    e.preventDefault();
    document.body.style.userSelect = "none";
    document.body.style.cursor = o.axis === "x" ? "col-resize" : "row-resize";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const o = optionsRef.current;
    const pos = o.axis === "x" ? e.clientX : e.clientY;
    const next = drag.size + drag.direction * (pos - drag.start);
    const clamped = Math.min(drag.max, Math.max(o.min, next));
    liveRef.current = clamped;
    setLive(clamped);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (liveRef.current !== null) optionsRef.current.onCommit(liveRef.current);
    liveRef.current = null;
    setLive(null);
  }, []);

  const onDoubleClick = useCallback(() => {
    optionsRef.current.onReset();
  }, []);

  // Arrow keys nudge the size when the handle has focus. Each press commits
  // directly; there is no live phase to batch.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const o = optionsRef.current;
    const keys = o.axis === "x" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
    const physical = e.key === keys[0] ? 1 : e.key === keys[1] ? -1 : 0;
    if (physical === 0) return;
    e.preventDefault();
    const direction = typeof o.direction === "function" ? o.direction() : o.direction;
    const size = typeof o.size === "function" ? o.size() : o.size;
    const max = typeof o.max === "function" ? o.max() : o.max;
    const next = size + direction * physical * KEYBOARD_STEP;
    o.onCommit(Math.min(max, Math.max(o.min, next)));
  }, []);

  const idle = typeof options.size === "function" ? null : options.size;
  return {
    size: live ?? idle,
    dragging: live !== null,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick,
      onKeyDown,
    },
  };
}
