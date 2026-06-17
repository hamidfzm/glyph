import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useElementSize } from "@/hooks/useElementSize";
import { useGraphCamera } from "@/hooks/useGraphCamera";
import { useGraphSimulation } from "@/hooks/useGraphSimulation";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { WikilinkRef } from "@/lib/backlinks";
import { buildWorkspaceGraph } from "@/lib/graph";
import {
  type Camera,
  drawGraph,
  fitCameraToNodes,
  hitTestNode,
  readGraphTheme,
  screenToWorld,
} from "@/lib/graphCanvas";
import { type LayoutNode, pinNode, releaseNode } from "@/lib/graphSimulation";

interface GraphViewProps {
  workspaceFiles: readonly string[];
  wikilinkRefs: readonly WikilinkRef[];
  /** Open the clicked note inside its workspace. */
  onOpenFile: (path: string) => void;
}

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

// Force-directed picture of the active workspace: every markdown file is a
// node, every resolved wikilink an edge. Heavy lifting is delegated — model
// building to lib/graph, physics to useGraphSimulation, camera math and
// drawing to lib/graphCanvas — so this component only wires canvas events.
//
// The view auto-frames the graph (centres + fits it) and keeps re-framing as
// the layout settles, until the first time the user pans, zooms, or drags a
// node; from then the camera is theirs until they hit "Reset view". Dragging a
// node pins it under the cursor and reheats the simulation, like Obsidian.
export function GraphView({ workspaceFiles, wikilinkRefs, onOpenFile }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, size: viewport } = useElementSize<HTMLDivElement>();
  const graph = useMemo(
    () => buildWorkspaceGraph(workspaceFiles, wikilinkRefs),
    [workspaceFiles, wikilinkRefs],
  );
  const { layout, version, reheat } = useGraphSimulation(graph);
  const camera = useGraphCamera();
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const isDark = useIsDarkMode();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read CSS variables when the theme flips
  const theme = useMemo(() => readGraphTheme(document.documentElement), [isDark]);

  // Auto-fit follows the live layout until the user takes manual control.
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  useEffect(() => {
    autoFitRef.current = autoFit;
  }, [autoFit]);

  const pointer = useRef<ActivePointer | null>(null);

  // The camera actually used to draw and hit-test: a live fit while auto-fit is
  // on, the user's camera once they take over. Recomputed as the layout moves
  // (version) so the framing tracks the animation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` forces a re-fit as d3 mutates node positions in place — the layout reference itself is stable between frames
  const effectiveCamera = useMemo(
    () => (autoFit ? fitCameraToNodes(layout.nodes, viewport) : camera.camera),
    [autoFit, camera.camera, layout, version, viewport],
  );

  // The camera under the cursor right now (used inside event handlers, which
  // can fire before `effectiveCamera` re-memoises).
  const cameraNow = useCallback(
    (): Camera => (autoFitRef.current ? fitCameraToNodes(layout.nodes, viewport) : camera.camera),
    [camera.camera, layout, viewport],
  );

  // Switch from auto-fit to manual control, seeding the user's camera with the
  // current framing so nothing jumps.
  const takeManualControl = useCallback(() => {
    if (!autoFitRef.current) return;
    autoFitRef.current = false;
    camera.set(fitCameraToNodes(layout.nodes, viewport));
    setAutoFit(false);
  }, [camera, layout, viewport]);

  // Redraw on every change that affects pixels: layout motion (version),
  // camera, hover, viewport size, theme.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the redraw trigger — d3 mutates layout node positions in place, so neither the layout reference nor a manual camera changes between animation frames
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || viewport.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    drawGraph(ctx, layout, {
      viewport,
      dpr,
      camera: effectiveCamera,
      theme,
      hoveredId: hovered?.id ?? null,
      neighbors: graph.neighbors,
    });
  }, [layout, version, effectiveCamera, hovered?.id, viewport, theme, graph.neighbors]);

  const localPoint = useCallback((event: ReactPointerEvent | WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);

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
  }, [camera, localPoint, takeManualControl, viewport]);

  const refit = useCallback(() => {
    autoFitRef.current = true;
    setAutoFit(true);
  }, []);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-print-hide="true">
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No notes to graph yet. Add markdown files to this workspace.
        </p>
      </div>
    );
  }

  const dragging = pointer.current?.moved ?? false;
  const cursor = dragging ? "grabbing" : hovered ? "pointer" : "grab";

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden" data-print-hide="true">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Workspace graph"
        className="absolute inset-0 touch-none"
        style={{ width: viewport.width, height: viewport.height, cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHovered(null)}
      />
      <button
        type="button"
        onClick={refit}
        disabled={autoFit}
        className="absolute top-3 right-3 px-2.5 py-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] enabled:hover:text-[var(--color-text-primary)] disabled:opacity-40"
        title="Re-centre and fit the graph"
      >
        Reset view
      </button>
      {hovered && (
        <div
          className="absolute pointer-events-none px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] max-w-[60%] truncate"
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          {hovered.id}
        </div>
      )}
    </div>
  );
}
