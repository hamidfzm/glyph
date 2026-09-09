import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphCameraApi } from "@/hooks/useGraphCamera";
import { type Camera, centerCameraOn, FOCUS_SCALE, lerpCamera } from "@/lib/graphCanvas";
import type { GraphLayout, LayoutNode } from "@/lib/graphSimulation";
import { createSpringAnimation, type SpringAnimation } from "@/lib/spring";

// Windows' default double-click time, and the longest of the platform defaults.
// The camera move waits it out so a double click never starts an animation on
// its way to opening the note; the highlight still lands on the first press.
export const DOUBLE_CLICK_MS = 500;

interface UseGraphFocusOptions {
  camera: GraphCameraApi;
  /** The camera under the cursor right now, read inside event handlers. */
  cameraNow: () => Camera;
  /** Switch the view from auto-fit to the user's own camera. */
  takeManualControl: () => void;
  layout: GraphLayout;
}

export interface GraphFocusApi {
  /** Node held in focus; its neighbourhood stays highlighted until cleared. */
  focusedId: string | null;
  focusNode: (node: LayoutNode) => void;
  clearFocus: () => void;
  /** Drop a pending or running camera move, keeping the highlight. */
  cancelMove: () => void;
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
  layout,
}: UseGraphFocusOptions): GraphFocusApi {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timerRef = useRef(0);
  const animationRef = useRef<SpringAnimation | null>(null);
  // The deferred move reads the camera and the layout when it fires, not when it
  // was scheduled, so a zoom or a re-index inside the window cannot strand it.
  const cameraNowRef = useRef(cameraNow);
  cameraNowRef.current = cameraNow;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const setCamera = camera.set;

  const cancelMove = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    animationRef.current?.stop();
    animationRef.current = null;
  }, []);

  const focusNode = useCallback(
    (node: LayoutNode) => {
      cancelMove();
      takeManualControl();
      setFocusedId(node.id);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        // Re-resolve by id: a re-index swaps every node object, and d3 moves the
        // survivors on as the layout keeps settling.
        const target = layoutRef.current.nodes.find((n) => n.id === node.id);
        if (!target) return;
        const from = cameraNowRef.current();
        const to = centerCameraOn(target.x ?? 0, target.y ?? 0, Math.max(from.scale, FOCUS_SCALE));
        const animation = createSpringAnimation({
          initial: 0,
          onFrame: (progress) => setCamera(lerpCamera(from, to, progress)),
        });
        animationRef.current = animation;
        animation.animateTo(1);
      }, DOUBLE_CLICK_MS);
    },
    [cancelMove, setCamera, takeManualControl],
  );

  const clearFocus = useCallback(() => {
    cancelMove();
    setFocusedId(null);
  }, [cancelMove]);

  // A focused note can leave the graph (deleted, renamed, unindexed). Its id
  // would then dim the whole graph with nothing lit, so drop it.
  useEffect(() => {
    setFocusedId((id) => (id !== null && !layout.nodes.some((n) => n.id === id) ? null : id));
  }, [layout]);

  useEffect(() => cancelMove, [cancelMove]);

  return { focusedId, focusNode, clearFocus, cancelMove };
}
