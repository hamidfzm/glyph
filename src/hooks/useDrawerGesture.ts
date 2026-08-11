import { useCallback, useLayoutEffect, useRef } from "react";
import {
  createVelocityTracker,
  drawerOpenSign,
  drawerReleaseTarget,
  rubberband,
} from "@/lib/gesture";
import { createSpringAnimation, type SpringAnimation } from "@/lib/spring";

// A drag must move this far before it counts as a drawer gesture (and not a
// tap or a vertical scroll); the dominant axis then wins.
const DRAG_THRESHOLD = 8;

interface UseDrawerGestureOptions {
  /** Only the compact (phone) drawer is a gesture sheet. */
  enabled: boolean;
  /** Physical screen edge the drawer clings to, RTL already resolved. */
  edge: "left" | "right";
  /** Shared registry from useSidebarLayout; closing animates via these. */
  dismissals: Set<(onDone: () => void) => void>;
  /** The animated compact-drawer close (runs the registered dismissals). */
  close: () => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startValue: number;
  width: number;
  engaged: boolean;
  rejected: boolean;
}

/**
 * Makes the compact sidebar drawer a momentum sheet: spring in on mount,
 * 1:1 horizontal drag with rubberbanding past the open edge, momentum
 * projection deciding open vs dismiss at release, and the release velocity
 * handed to the settle spring. The spring writes `--presence` on the drawer
 * and on its parent (where the sibling backdrop reads it for its fade).
 */
export function useDrawerGesture(options: UseDrawerGestureOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const elRef = useRef<HTMLElement | null>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const springRef = useRef<SpringAnimation | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trackerRef = useRef(createVelocityTracker());
  const doneRef = useRef<(() => void) | null>(null);
  const releaseVelocityRef = useRef<number | null>(null);
  const draggedRef = useRef(false);

  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!options.enabled || !el) return;
    parentRef.current = el.parentElement;
    // The parent copy is per-edge so two mounted drawers (files left,
    // outline right) don't fight over one property; the backdrop takes the
    // max of both.
    const parentVar = `--presence-${options.edge}`;
    const spring = createSpringAnimation({
      initial: 0,
      onFrame: (value) => {
        const presence = String(value);
        elRef.current?.style.setProperty("--presence", presence);
        parentRef.current?.style.setProperty(parentVar, presence);
      },
      onSettle: (target) => {
        if (target !== 0) return;
        const done = doneRef.current;
        doneRef.current = null;
        done?.();
      },
    });
    springRef.current = spring;
    el.style.setProperty("--presence", "0");
    spring.animateTo(1);

    const dismiss = (onDone: () => void) => {
      doneRef.current = onDone;
      springRef.current?.animateTo(0, releaseVelocityRef.current ?? undefined);
      releaseVelocityRef.current = null;
    };
    optionsRef.current.dismissals.add(dismiss);

    return () => {
      optionsRef.current.dismissals.delete(dismiss);
      springRef.current?.stop();
      springRef.current = null;
      // A dismissal interrupted by unmount (e.g. resizing out of compact)
      // still settles the layout state, or the drawer pops back open later.
      const done = doneRef.current;
      doneRef.current = null;
      done?.();
      parentRef.current?.style.removeProperty(parentVar);
      parentRef.current = null;
    };
  }, [options.enabled, options.edge]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const el = elRef.current;
    const spring = springRef.current;
    if (!optionsRef.current.enabled || !el || !spring) return;
    if (event.button !== 0) return;
    // The resize handle owns its own drag.
    if ((event.target as Element).closest("[data-resize-handle]")) return;
    // Grab: freeze wherever the drawer is; a tap resumes on release. The
    // grab also disarms any pending dismissal completion, or a rescued
    // drawer would be silently closed by the stale callback later; a real
    // dismissal re-arms it through close().
    spring.stop();
    doneRef.current = null;
    draggedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: spring.value(),
      width: el.offsetWidth,
      engaged: false,
      rejected: false,
    };
    trackerRef.current.reset();
    trackerRef.current.add(
      event.clientX * drawerOpenSign(optionsRef.current.edge),
      event.timeStamp,
    );
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const spring = springRef.current;
    if (!drag || drag.rejected || !spring || event.pointerId !== drag.pointerId) return;
    // A mouse released outside the drawer before engage never delivers its
    // pointerup here (capture starts at engage), so a later buttonless hover
    // would resume the drag. Treat it as a cancel.
    if (event.buttons === 0) {
      dragRef.current = null;
      spring.animateTo(1);
      return;
    }
    // Pointer x is mapped so positive always means "toward open".
    const sign = drawerOpenSign(optionsRef.current.edge);
    trackerRef.current.add(event.clientX * sign, event.timeStamp);
    if (!drag.engaged) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dy > DRAG_THRESHOLD && dy > dx) {
        drag.rejected = true;
        return;
      }
      if (dx <= DRAG_THRESHOLD || dx <= dy) return;
      drag.engaged = true;
      draggedRef.current = true;
      // Re-baseline at the engage point so the drawer doesn't hop by the
      // accumulated slop on this first tracked frame.
      drag.startX = event.clientX;
      elRef.current?.setPointerCapture?.(event.pointerId);
    }
    const raw = drag.startValue + ((event.clientX - drag.startX) * sign) / drag.width;
    let next = raw;
    if (raw < 0) next = 0;
    if (raw > 1) next = 1 + rubberband((raw - 1) * drag.width, drag.width) / drag.width;
    spring.moveTo(next);
  }, []);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const spring = springRef.current;
    if (!drag || !spring || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (!drag.engaged) {
      // A plain tap (or a rejected vertical scroll) puts the drawer back.
      spring.animateTo(1);
      return;
    }
    const velocity = trackerRef.current.velocity(event.timeStamp);
    const presenceVelocity = velocity / drag.width;
    if (drawerReleaseTarget(spring.value() * drag.width, velocity, drag.width) === 0) {
      releaseVelocityRef.current = presenceVelocity;
      optionsRef.current.close();
      return;
    }
    spring.animateTo(1, presenceVelocity);
  }, []);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    // A canceled pointer fires no trailing click, so nothing would consume
    // the swallow flag and the next real tap would be eaten.
    draggedRef.current = false;
    springRef.current?.animateTo(1);
  }, []);

  // After a real drag, the pointerup still produces a click on whatever row
  // the finger ended over; swallow that one click.
  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    ref,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerCancel,
      onClickCapture: handleClickCapture,
    },
  };
}
