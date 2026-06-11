import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, useState } from "react";
import { nodeAtPoint, nodeIdsInGroup, type Point, sideAnchor } from "@/lib/canvas/geometry";
import { moveNodes, resizeNode } from "@/lib/canvas/mutations";
import type { CanvasData, CanvasNode, NodeSide } from "@/lib/canvas/types";

const MIN_SIZE = 60;

type Gesture = (
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "move"; start: Point; base: CanvasData; ids: ReadonlySet<string>; latest: CanvasData }
  | { kind: "resize"; id: string; start: Point; base: CanvasData; latest: CanvasData }
  | { kind: "connect"; fromId: string; fromSide: NodeSide }
) & {
  /** Set once the pointer is captured (deferred to the first real movement). */
  captured?: boolean;
};

interface UseCanvasGesturesOptions {
  stageRef: RefObject<HTMLDivElement | null>;
  worldAt: (e: { clientX: number; clientY: number }) => Point;
  panBy: (dx: number, dy: number) => void;
  getData: () => CanvasData;
  /** Live drag/resize frame — local state only, not persisted. */
  setLive: (data: CanvasData) => void;
  /** A finished move/resize — persisted as one undo entry. */
  commit: (data: CanvasData) => void;
  selection: ReadonlySet<string>;
  /** Pointer went down on empty stage: clear selection and editing state. */
  onStageDown: () => void;
  /** A connect drag was released over `target`. */
  onConnect: (fromId: string, fromSide: NodeSide, target: CanvasNode) => void;
}

/**
 * The board's pointer-gesture state machine: background panning, node
 * move/resize with one commit per finished gesture, and connector drags with
 * a live preview line. Pointer capture is deferred until the first real
 * movement — capturing on pointerdown would retarget the browser's
 * compatibility mouse events (including dblclick) to the stage, so
 * double-clicking a card would create a new card instead of editing it.
 */
export function useCanvasGestures(options: UseCanvasGesturesOptions) {
  const { stageRef, worldAt, panBy, getData, setLive, commit, selection, onStageDown, onConnect } =
    options;
  const gesture = useRef<Gesture | null>(null);
  const [tempEdge, setTempEdge] = useState<{ from: Point; to: Point } | null>(null);

  const captureOnFirstMove = (g: Gesture, e: ReactPointerEvent) => {
    if (g.captured) return;
    g.captured = true;
    stageRef.current?.setPointerCapture?.(e.pointerId);
  };

  const startMove = (id: string, e: ReactPointerEvent) => {
    let ids: ReadonlySet<string>;
    if (selection.has(id)) {
      ids = selection;
    } else {
      const node = getData().nodes.find((n) => n.id === id);
      // Dragging a group carries everything inside its bounds along with it —
      // that containment is what makes a group a group rather than a card.
      ids =
        node?.type === "group"
          ? new Set([id, ...nodeIdsInGroup(getData().nodes, node)])
          : new Set([id]);
    }
    gesture.current = { kind: "move", start: worldAt(e), base: getData(), ids, latest: getData() };
  };

  const startResize = (id: string, e: ReactPointerEvent) => {
    gesture.current = { kind: "resize", id, start: worldAt(e), base: getData(), latest: getData() };
  };

  const startConnect = (fromId: string, side: NodeSide, e: ReactPointerEvent) => {
    const node = getData().nodes.find((n) => n.id === fromId);
    /* v8 ignore start -- defensive: connect starts from a rendered node, always found */
    if (!node) return;
    /* v8 ignore stop */
    gesture.current = { kind: "connect", fromId, fromSide: side };
    setTempEdge({ from: sideAnchor(node, side), to: worldAt(e) });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onStageDown();
    gesture.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    captureOnFirstMove(g, e);
    if (g.kind === "pan") {
      panBy(e.clientX - g.lastX, e.clientY - g.lastY);
      g.lastX = e.clientX;
      g.lastY = e.clientY;
    } else if (g.kind === "move") {
      const w = worldAt(e);
      g.latest = moveNodes(g.base, g.ids, w.x - g.start.x, w.y - g.start.y);
      setLive(g.latest);
    } else if (g.kind === "resize") {
      const w = worldAt(e);
      const node = g.base.nodes.find((n) => n.id === g.id);
      /* v8 ignore start -- defensive: resize id always references an existing node */
      if (!node) return;
      /* v8 ignore stop */
      const width = Math.max(MIN_SIZE, node.width + (w.x - g.start.x));
      const height = Math.max(MIN_SIZE, node.height + (w.y - g.start.y));
      g.latest = resizeNode(g.base, g.id, { x: node.x, y: node.y, width, height });
      setLive(g.latest);
    } else {
      // The gesture kind is exhaustive: pan/move/resize are handled above, so
      // this branch is always a connect gesture (and tempEdge is set).
      setTempEdge((t) =>
        t
          ? { ...t, to: worldAt(e) }
          : // v8 ignore next -- defensive: tempEdge is always set while a connect gesture is active
            t,
      );
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.captured) stageRef.current?.releasePointerCapture?.(e.pointerId);
    if ((g.kind === "move" || g.kind === "resize") && g.latest !== g.base) {
      commit(g.latest);
    } else if (g.kind === "connect") {
      const target = nodeAtPoint(getData().nodes, worldAt(e), new Set([g.fromId]));
      if (target) onConnect(g.fromId, g.fromSide, target);
      setTempEdge(null);
    }
  };

  return {
    tempEdge,
    startMove,
    startResize,
    startConnect,
    stageHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
