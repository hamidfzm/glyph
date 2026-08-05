import { type RefObject, useCallback, useEffect, useState } from "react";
import { useZoomApi } from "@/contexts/ZoomContext";
import { clampScale, fitScale, ZOOM_STEP } from "@/lib/lightbox";

const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * Zoom state for an image laid out inside a scrollable stage: fit-to-stage,
 * stepped zoom, actual size, Ctrl/Cmd + wheel, and the app-level Zoom
 * In/Out/Actual-Size commands while this surface is active.
 *
 * `naturalRef` carries the image's intrinsic pixel size (null until it loads,
 * and for SVGs that only declare a viewBox). It is a ref because the fit math
 * runs inside a load handler, before the matching state has committed.
 */
export function useImageZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  naturalRef: RefObject<{ w: number; h: number } | null>,
) {
  const [scale, setScale] = useState(1);
  const [isFit, setIsFit] = useState(true);

  const computeFit = useCallback(() => {
    const stage = stageRef.current;
    const size = naturalRef.current;
    if (!stage || !size) return 1;
    const styles = getComputedStyle(stage);
    const availWidth =
      stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const availHeight =
      stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    return fitScale(size.w, size.h, availWidth, availHeight);
  }, [naturalRef, stageRef]);

  const applyFit = useCallback(() => {
    setScale(computeFit());
    setIsFit(true);
  }, [computeFit]);

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => clampScale(s * factor));
    setIsFit(false);
  }, []);

  const actualSize = useCallback(() => {
    setScale(1);
    setIsFit(false);
  }, []);

  // Keep a fitted image fitted on resize, unless the user has zoomed.
  useEffect(() => {
    if (!isFit) return;
    const handleResize = () => setScale(computeFit());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFit, computeFit]);

  // Route the Zoom In/Out/Actual-Size commands to this viewer while it's the
  // active surface. Actual Size maps to 100%, matching the toolbar button.
  const registerZoomTarget = useZoomApi()?.registerTarget;
  useEffect(() => {
    if (!registerZoomTarget) return;
    registerZoomTarget({
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      zoomReset: actualSize,
    });
    return () => registerZoomTarget(null);
  }, [registerZoomTarget, zoomBy, actualSize]);

  // Ctrl/Cmd + wheel zooms; a plain wheel keeps panning a zoomed image. Native
  // non-passive listener so preventDefault cancels the scroll.
  useEffect(() => {
    const stage = stageRef.current;
    /* v8 ignore start -- defensive: the stage div is always mounted by now */
    if (!stage) return;
    /* v8 ignore stop */
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setScale((s) => clampScale(s * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED)));
      setIsFit(false);
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [stageRef]);

  return { scale, applyFit, zoomBy, actualSize };
}
