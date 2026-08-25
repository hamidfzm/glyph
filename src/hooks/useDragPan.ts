import { type RefObject, useEffect } from "react";

// Pixels of movement before a press counts as a drag (not a click).
const DRAG_THRESHOLD = 3;

/**
 * Drag-to-pan for a scrollable element: press and drag to move a zoomed image
 * or diagram around, instead of only scroll wheels. No-op until the content
 * overflows (nothing to pan otherwise). After a real drag it swallows the
 * trailing click so the gesture doesn't also trigger click-to-close /
 * click-to-zoom on the same element.
 *
 * Mirrors its state onto the element as `data-pannable` (content overflows,
 * a drag would move it) and `data-grabbing` (a drag is in progress) so the
 * stylesheet can show grab/grabbing cursors.
 */
export function useDragPan(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const canPan = () => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

    const syncPannable = () => el.toggleAttribute("data-pannable", canPan());

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !canPan()) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      el.setPointerCapture?.(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true;
        el.setAttribute("data-grabbing", "");
      }
      if (moved) {
        el.scrollLeft = startLeft - dx;
        el.scrollTop = startTop - dy;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture?.(e.pointerId);
      el.removeAttribute("data-grabbing");
      syncPannable();
      if (moved) {
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
      }
    };

    // Overflow changes when the content zooms or the element resizes, not on
    // any event of its own, so watch the element and its content through a
    // ResizeObserver (guarded: test DOMs may not implement it).
    syncPannable();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(syncPannable);
      observer.observe(el);
      for (const child of el.children) observer.observe(child);
    }

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerUp);
    return () => {
      observer?.disconnect();
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [ref]);
}
