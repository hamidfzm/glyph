import { useEffect, useRef } from "react";
import { useZoomApi, type ZoomHandlers } from "@/contexts/ZoomContext";
import type { GraphCameraApi } from "@/hooks/useGraphCamera";
import type { Viewport } from "@/lib/graphCanvas";

// Zoom factor per Zoom In / Zoom Out command (keyboard / menu).
const HOTKEY_ZOOM_FACTOR = 1.2;

interface UseGraphZoomCommandsOptions {
  camera: GraphCameraApi;
  viewport: Viewport;
  /** Switch the view from auto-fit to the user's own camera. */
  takeManualControl: () => void;
  /** Re-frame the graph and return it to auto-fit (the Reset view action). */
  refit: () => void;
}

/**
 * Routes the Zoom In/Out/Actual-Size commands to the graph camera while the
 * graph is the active surface, anchored on the viewport centre. Wheel zoom is
 * wired separately in `useGraphPointer`. The handlers read the latest
 * camera/viewport through a ref, so registration happens once per mount rather
 * than on every camera frame.
 */
export function useGraphZoomCommands({
  camera,
  viewport,
  takeManualControl,
  refit,
}: UseGraphZoomCommandsOptions): void {
  const registerZoomTarget = useZoomApi()?.registerTarget;
  const zoomImplRef = useRef<() => ZoomHandlers>(() => ({
    zoomIn: () => {},
    zoomOut: () => {},
    zoomReset: () => {},
  }));
  zoomImplRef.current = () => {
    const zoomCenter = (factor: number) => {
      takeManualControl();
      camera.zoomAt(viewport.width / 2, viewport.height / 2, factor, viewport);
    };
    return {
      zoomIn: () => zoomCenter(HOTKEY_ZOOM_FACTOR),
      zoomOut: () => zoomCenter(1 / HOTKEY_ZOOM_FACTOR),
      zoomReset: refit,
    };
  };

  useEffect(() => {
    if (!registerZoomTarget) return;
    registerZoomTarget({
      zoomIn: () => zoomImplRef.current().zoomIn(),
      zoomOut: () => zoomImplRef.current().zoomOut(),
      zoomReset: () => zoomImplRef.current().zoomReset(),
    });
    return () => registerZoomTarget(null);
  }, [registerZoomTarget]);
}
