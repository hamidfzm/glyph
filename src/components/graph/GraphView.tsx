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
import { drawGraph, hitTestNode, readGraphTheme } from "@/lib/graphCanvas";

interface GraphViewProps {
  workspaceFiles: readonly string[];
  wikilinkRefs: readonly WikilinkRef[];
  /** Open the clicked note inside its workspace. */
  onOpenFile: (path: string) => void;
}

// A click that travels further than this (screen px) is a pan, not a click.
const CLICK_SLOP_PX = 4;
const WHEEL_ZOOM_SPEED = 0.0015;

// Force-directed picture of the active workspace: every markdown file is a
// node, every resolved wikilink an edge. Heavy lifting is delegated — model
// building to lib/graph, physics to useGraphSimulation, camera math and
// drawing to lib/graphCanvas — so this component only wires canvas events.
export function GraphView({ workspaceFiles, wikilinkRefs, onOpenFile }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, size: viewport } = useElementSize<HTMLDivElement>();
  const graph = useMemo(
    () => buildWorkspaceGraph(workspaceFiles, wikilinkRefs),
    [workspaceFiles, wikilinkRefs],
  );
  const { layout, version } = useGraphSimulation(graph);
  const camera = useGraphCamera();
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const isDark = useIsDarkMode();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read CSS variables when the theme flips
  const theme = useMemo(() => readGraphTheme(document.documentElement), [isDark]);

  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  // Redraw on every change that affects pixels: layout motion (version),
  // camera, hover, viewport size, theme.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the redraw trigger — d3 mutates layout node positions in place, so the layout reference alone never changes between frames
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
      camera: camera.camera,
      theme,
      hoveredId: hovered?.id ?? null,
      neighbors: graph.neighbors,
    });
  }, [layout, version, camera.camera, hovered?.id, viewport, theme, graph.neighbors]);

  const localPoint = useCallback((event: ReactPointerEvent | WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      pointer.current = { id: event.pointerId, ...point, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [localPoint],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const drag = pointer.current;
      if (drag && drag.id === event.pointerId) {
        const dx = point.x - drag.x;
        const dy = point.y - drag.y;
        if (drag.moved || Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX) {
          drag.moved = true;
          camera.pan(dx, dy);
          pointer.current = { ...drag, ...point };
          setHovered(null);
        }
        return;
      }
      const hit = hitTestNode(layout.nodes, camera.camera, viewport, point.x, point.y);
      setHovered(hit ? { id: hit.id, x: point.x, y: point.y } : null);
    },
    [camera, layout.nodes, localPoint, viewport],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = pointer.current;
      pointer.current = null;
      if (!drag || drag.id !== event.pointerId || drag.moved) return;
      const point = localPoint(event);
      const hit = hitTestNode(layout.nodes, camera.camera, viewport, point.x, point.y);
      if (hit) onOpenFile(hit.id);
    },
    [camera.camera, layout.nodes, localPoint, onOpenFile, viewport],
  );

  // Wheel must be a native non-passive listener to preventDefault scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      camera.zoomAt(point.x, point.y, Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), viewport);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [camera, localPoint, viewport]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-print-hide="true">
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No notes to graph yet — add markdown files to this workspace.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden" data-print-hide="true">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Workspace graph"
        className="absolute inset-0 touch-none"
        style={{
          width: viewport.width,
          height: viewport.height,
          cursor: pointer.current?.moved ? "grabbing" : hovered ? "pointer" : "grab",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHovered(null)}
      />
      <button
        type="button"
        onClick={camera.reset}
        className="absolute top-3 right-3 px-2.5 py-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        title="Reset view"
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
