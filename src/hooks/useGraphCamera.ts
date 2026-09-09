import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Camera,
  DEFAULT_CAMERA,
  panCamera,
  type Viewport,
  zoomCameraAt,
} from "@/lib/graphCanvas";
import { loadGraphView, saveGraphView } from "@/lib/graphViewStore";

export interface GraphCameraApi {
  camera: Camera;
  /** Shift the view by a screen-space delta (drag-to-pan). */
  pan: (dx: number, dy: number) => void;
  /** Zoom by `factor`, anchored on the screen point (sx, sy). */
  zoomAt: (sx: number, sy: number, factor: number, viewport: Viewport) => void;
  /** Replace the camera outright (used to seed manual control from auto-fit). */
  set: (camera: Camera) => void;
}

/**
 * Pan/zoom camera state for the graph view; the math lives in lib/graphCanvas.
 * `persistKey` (the workspace root) keeps the camera alive across the graph
 * tab's unmount, so switching away and back does not snap the view around.
 */
export function useGraphCamera(persistKey?: string): GraphCameraApi {
  const [camera, setCamera] = useState<Camera>(
    () => (persistKey ? loadGraphView(persistKey)?.camera : undefined) ?? DEFAULT_CAMERA,
  );
  useEffect(() => {
    if (persistKey) saveGraphView(persistKey, { camera });
  }, [persistKey, camera]);
  const pan = useCallback((dx: number, dy: number) => {
    setCamera((c) => panCamera(c, dx, dy));
  }, []);
  const zoomAt = useCallback((sx: number, sy: number, factor: number, viewport: Viewport) => {
    setCamera((c) => zoomCameraAt(c, sx, sy, factor, viewport));
  }, []);
  const set = useCallback((next: Camera) => setCamera(next), []);
  return useMemo(() => ({ camera, pan, zoomAt, set }), [camera, pan, zoomAt, set]);
}
