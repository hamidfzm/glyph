import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FitIcon } from "@/components/icons/FitIcon";
import { useZoomApi, type ZoomHandlers } from "@/contexts/ZoomContext";
import { useElementSize } from "@/hooks/useElementSize";
import { useGraphCamera } from "@/hooks/useGraphCamera";
import { useGraphPointer } from "@/hooks/useGraphPointer";
import { useGraphSimulation } from "@/hooks/useGraphSimulation";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { WikilinkRef } from "@/lib/backlinks";
import { buildWorkspaceGraph } from "@/lib/graph";
import { type Camera, fitCameraToNodes } from "@/lib/graphCanvas";
import { drawGraph, readGraphTheme } from "@/lib/graphDraw";

interface GraphViewProps {
  workspaceFiles: readonly string[];
  wikilinkRefs: readonly WikilinkRef[];
  /** Open the clicked note inside its workspace. */
  onOpenFile: (path: string) => void;
}

// Zoom factor per Zoom In / Zoom Out command (keyboard / menu).
const HOTKEY_ZOOM_FACTOR = 1.2;

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
  const { t } = useTranslation("common");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, size: viewport } = useElementSize<HTMLDivElement>();
  const registerZoomTarget = useZoomApi()?.registerTarget;
  const graph = useMemo(
    () => buildWorkspaceGraph(workspaceFiles, wikilinkRefs),
    [workspaceFiles, wikilinkRefs],
  );
  const { layout, version, reheat } = useGraphSimulation(graph);
  const camera = useGraphCamera();
  const isDark = useIsDarkMode();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read CSS variables when the theme flips
  const theme = useMemo(() => readGraphTheme(document.documentElement), [isDark]);

  // Auto-fit follows the live layout until the user takes manual control.
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  useEffect(() => {
    autoFitRef.current = autoFit;
  }, [autoFit]);

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

  const { hovered, dragging, clearHover, handlePointerDown, handlePointerMove, handlePointerUp } =
    useGraphPointer({
      canvasRef,
      layout,
      viewport,
      camera,
      cameraNow,
      takeManualControl,
      reheat,
      onOpenFile,
    });

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

  const refit = useCallback(() => {
    autoFitRef.current = true;
    setAutoFit(true);
  }, []);

  // Route the Zoom In/Out/Actual-Size commands to the camera while the graph is
  // the active surface, anchored on the viewport centre. Wheel zoom is wired
  // separately above. The handlers read the latest camera/viewport through a
  // ref so registration happens once per mount, not on every camera frame.
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

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-print-hide="true">
        <p className="text-sm text-[var(--color-text-tertiary)]">{t("graph.emptyState")}</p>
      </div>
    );
  }

  const cursor = dragging ? "grabbing" : hovered ? "pointer" : "grab";

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden" data-print-hide="true">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("graph.label")}
        className="absolute inset-0 touch-none"
        style={{ width: viewport.width, height: viewport.height, cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={clearHover}
      />
      <button
        type="button"
        onClick={refit}
        disabled={autoFit}
        className="absolute top-3 end-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] enabled:hover:text-[var(--color-text-primary)] disabled:opacity-40"
        title={t("graph.reset")}
      >
        <FitIcon className="w-3.5 h-3.5" />
        {t("graph.resetView")}
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
