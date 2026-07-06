import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Point, Rect } from "@/lib/canvas/geometry";
import {
  fitToContent as computeFit,
  pan as panViewport,
  type Viewport,
  zoomAt,
} from "@/lib/canvas/viewport";
import { loadViewport, saveViewport } from "@/lib/canvas/viewportStore";

const WHEEL_ZOOM_INTENSITY = 0.0015;

interface UseCanvasViewport {
  viewport: Viewport;
  /** True when a persisted viewport was restored — callers skip the initial fit. */
  restored: boolean;
  /** Attach to the stage element — owns the (non-passive) wheel listener. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Pan by a screen-space delta (used by background-drag panning). */
  panBy: (dx: number, dy: number) => void;
  /** Multiply zoom by `factor`, pivoting on the stage centre by default. */
  zoomBy: (factor: number) => void;
  /** Centre the given world-space rect within the stage. */
  fitTo: (rect: Rect | null) => void;
  /** Convert a clientX/clientY mouse position to stage-relative coordinates. */
  toStagePoint: (clientX: number, clientY: number) => Point;
}

/**
 * Owns the canvas pan/zoom transform. Trackpad/scroll pans; ctrl/⌘+scroll (and
 * pinch, which the OS delivers as ctrl+wheel) zooms toward the cursor. The
 * wheel listener is attached natively with `{ passive: false }` so it can
 * `preventDefault` and stop the page from scrolling.
 *
 * `persistKey` keeps the transform alive across remounts: the viewer and
 * editor are different components, so switching view/edit modes would
 * otherwise reset the board to the origin. Same key → same viewpoint.
 */
export function useCanvasViewport(persistKey?: string): UseCanvasViewport {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(
    () => (persistKey ? loadViewport(persistKey) : undefined) ?? { x: 0, y: 0, zoom: 1 },
  );
  const restored = useRef(persistKey ? loadViewport(persistKey) !== undefined : false).current;
  // Mirror state into a ref so the native wheel handler always reads fresh
  // values without being re-bound on every viewport change.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    if (persistKey) saveViewport(persistKey, viewport);
  }, [persistKey, viewport]);

  const toStagePoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((vp) => panViewport(vp, dx, dy));
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const pivot: Point = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
    setViewport((vp) => zoomAt(vp, factor, pivot));
  }, []);

  const fitTo = useCallback((rect: Rect | null) => {
    const stage = stageRef.current;
    if (!stage) return;
    setViewport(computeFit(rect, stage.clientWidth, stage.clientHeight));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pivot = toStagePoint(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_INTENSITY);
        setViewport((vp) => zoomAt(vp, factor, pivot));
      } else {
        setViewport((vp) => panViewport(vp, -e.deltaX, -e.deltaY));
      }
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [toStagePoint]);

  return { viewport, restored, stageRef, panBy, zoomBy, fitTo, toStagePoint };
}
