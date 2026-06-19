import { useCallback, useMemo, useState } from "react";
import {
  type Camera,
  DEFAULT_CAMERA,
  panCamera,
  type Viewport,
  zoomCameraAt,
} from "@/lib/graphCanvas";

export interface GraphCameraApi {
  camera: Camera;
  /** Shift the view by a screen-space delta (drag-to-pan). */
  pan: (dx: number, dy: number) => void;
  /** Zoom by `factor`, anchored on the screen point (sx, sy). */
  zoomAt: (sx: number, sy: number, factor: number, viewport: Viewport) => void;
  /** Replace the camera outright (used to seed manual control from auto-fit). */
  set: (camera: Camera) => void;
}

/** Pan/zoom camera state for the graph view; the math lives in lib/graphCanvas. */
export function useGraphCamera(): GraphCameraApi {
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const pan = useCallback((dx: number, dy: number) => {
    setCamera((c) => panCamera(c, dx, dy));
  }, []);
  const zoomAt = useCallback((sx: number, sy: number, factor: number, viewport: Viewport) => {
    setCamera((c) => zoomCameraAt(c, sx, sy, factor, viewport));
  }, []);
  const set = useCallback((next: Camera) => setCamera(next), []);
  return useMemo(() => ({ camera, pan, zoomAt, set }), [camera, pan, zoomAt, set]);
}
