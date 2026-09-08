import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphCameraApi } from "@/hooks/useGraphCamera";
import { type Camera, centerCameraOn, FOCUS_SCALE, lerpCamera } from "@/lib/graphCanvas";
import type { LayoutNode } from "@/lib/graphSimulation";
import { createSpringAnimation, type SpringAnimation } from "@/lib/spring";

// The camera move waits out this window, so the first press of a double click
// never starts an animation on its way to opening the note.
export const DOUBLE_CLICK_MS = 280;

interface UseGraphFocusOptions {
  camera: GraphCameraApi;
  /** The camera under the cursor right now, read inside event handlers. */
  cameraNow: () => Camera;
  /** Switch the view from auto-fit to the user's own camera. */
  takeManualControl: () => void;
}

export interface GraphFocusApi {
  /** Node held in focus; its neighbourhood stays highlighted until cleared. */
  focusedId: string | null;
  focusNode: (node: LayoutNode) => void;
  clearFocus: () => void;
}

/**
 * Sticky focus for a graph node: the highlight lands at once, the camera follows
 * only after the double-click window, so clearing in between never animates.
 * `createSpringAnimation` snaps rather than tweens under reduced motion.
 */
export function useGraphFocus({
  camera,
  cameraNow,
  takeManualControl,
}: UseGraphFocusOptions): GraphFocusApi {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timerRef = useRef(0);
  const animationRef = useRef<SpringAnimation | null>(null);
  // The deferred move reads the camera when it fires, not when it was scheduled:
  // a wheel zoom inside the double-click window would otherwise make it jump.
  const cameraNowRef = useRef(cameraNow);
  cameraNowRef.current = cameraNow;

  const cancelPending = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    animationRef.current?.stop();
    animationRef.current = null;
  }, []);

  const focusNode = useCallback(
    (node: LayoutNode) => {
      cancelPending();
      takeManualControl();
      setFocusedId(node.id);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        // d3 mutates node positions in place, so read them here: a layout still
        // settling would have moved the node on since the press.
        const from = cameraNowRef.current();
        const to = centerCameraOn(node.x ?? 0, node.y ?? 0, Math.max(from.scale, FOCUS_SCALE));
        const animation = createSpringAnimation({
          initial: 0,
          onFrame: (progress) => camera.set(lerpCamera(from, to, progress)),
        });
        animationRef.current = animation;
        animation.animateTo(1);
      }, DOUBLE_CLICK_MS);
    },
    [camera, cancelPending, takeManualControl],
  );

  const clearFocus = useCallback(() => {
    cancelPending();
    setFocusedId(null);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  return { focusedId, focusNode, clearFocus };
}
