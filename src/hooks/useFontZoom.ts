import { useCallback } from "react";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/lib/settings";

interface UseFontZoomOptions {
  fontSize: number;
  updateSettings: (key: string, value: unknown) => void;
}

export function useFontZoom({ fontSize, updateSettings }: UseFontZoomOptions) {
  const zoomIn = useCallback(() => {
    updateSettings("appearance.fontSize", Math.min(fontSize + ZOOM_STEP, ZOOM_MAX));
  }, [fontSize, updateSettings]);

  const zoomOut = useCallback(() => {
    updateSettings("appearance.fontSize", Math.max(fontSize - ZOOM_STEP, ZOOM_MIN));
  }, [fontSize, updateSettings]);

  const zoomReset = useCallback(() => {
    updateSettings("appearance.fontSize", ZOOM_DEFAULT);
  }, [updateSettings]);

  return { zoomIn, zoomOut, zoomReset };
}
