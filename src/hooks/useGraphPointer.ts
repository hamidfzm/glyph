import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { useGraphCamera } from "@/hooks/useGraphCamera";
import { type Camera, hitTestNode, screenToWorld } from "@/lib/graphCanvas";
import { type GraphLayout, type LayoutNode, pinNode, releaseNode } from "@/lib/graphSimulation";

// A press that travels further than this (screen px) is a drag, not a click.
const CLICK_SLOP_PX = 4;
const WHEEL_ZOOM_SPEED = 0.0015;

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  /** Node under the press, if any — drives node-drag vs background-pan. Held by
   *  reference so a drag never has to re-find it (and survives a stale layout). */
  node: LayoutNode | null;
  /** Camera as it was when the gesture began; stable for the gesture's
   *  hit-tests and node-drag world conversion. */
  cam: Camera;
}

interface UseGraphPointerOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layout: GraphLayout;
  viewport: { width: number; height: number };
  camera: ReturnType<typeof useGraphCamera>;
  /** The camera under the cursor right now, read inside event handlers. */
  cameraNow: () => Camera;
  /** Switch the view from auto-fit to the user's own camera. */
  takeManualControl: () => void;
  reheat: (alpha?: number) => void;
  onOpenFile: (path: string) => void;
}

/**
 * The graph canvas gesture state machine: hover, background pan, node drag (pin
 * plus reheat), click-to-open, and wheel zoom. A press only becomes a drag once
 * it travels past the click slop, so a click never nudges the camera.
 */
export function useGraphPointer({
  canvasRef,
  layout,
  viewport,
  camera,
  cameraNow,
  takeManualControl,
  reheat,
  onOpenFile,
}: UseGraphPointerOptions) {
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const pointer = useRef<ActivePointer | null>(null);

  const localPoint = useCallback(
    (event: ReactPointerEvent | WheelEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    },
    [canvasRef],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const cam = cameraNow();
      const hit = hitTestNode(layout.nodes, cam, viewport, point.x, point.y);
      pointer.current = {
        id: event.pointerId,
        x: point.x,
        y: point.y,
        moved: false,
        node: hit,
        cam,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [cameraNow, layout.nodes, localPoint, viewport],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const drag = pointer.current;
      if (drag && drag.id === event.pointerId) {
        const dx = point.x - drag.x;
        const dy = point.y - drag.y;
        if (!drag.moved && Math.abs(dx) <= CLICK_SLOP_PX && Math.abs(dy) <= CLICK_SLOP_PX) {
          return;
        }
        if (!drag.moved) {
          drag.moved = true;
          takeManualControl();
          setHovered(null);
        }
        if (drag.node) {
          const world = screenToWorld(drag.cam, viewport, point.x, point.y);
          pinNode(drag.node, world.x, world.y);
          reheat();
        } else {
          camera.pan(dx, dy);
        }
        pointer.current = { ...drag, x: point.x, y: point.y };
        return;
      }
      const hit = hitTestNode(layout.nodes, cameraNow(), viewport, point.x, point.y);
      setHovered(hit ? { id: hit.id, x: point.x, y: point.y } : null);
    },
    [camera, cameraNow, layout.nodes, localPoint, reheat, takeManualControl, viewport],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = pointer.current;
      pointer.current = null;
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved) {
        // A press that never became a drag is a click: open the node's note.
        if (drag.node) onOpenFile(drag.node.id);
        return;
      }
      if (drag.node) {
        // Release the dragged node back into the flow and let neighbours relax.
        releaseNode(drag.node);
        reheat(0.1);
      }
    },
    [onOpenFile, reheat],
  );

  // Wheel must be a native non-passive listener to preventDefault scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      takeManualControl();
      const point = localPoint(event);
      camera.zoomAt(point.x, point.y, Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), viewport);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [camera, canvasRef, localPoint, takeManualControl, viewport]);

  return {
    hovered,
    // Read at render time, like the hover state: a pan or node drag re-renders
    // through the camera/simulation, so the cursor stays in step.
    dragging: pointer.current?.moved ?? false,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    /** Clear hover when the cursor leaves the canvas. */
    clearHover: () => setHovered(null),
  };
}
