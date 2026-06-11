import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
} from "react";
import { canvasColorToCss } from "@/lib/canvas/color";
import { arrowheadPoints, bezierPath, inferSide, sideAnchor } from "@/lib/canvas/geometry";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas/types";

interface CanvasEdgesProps {
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  /** When set, edges become clickable for selection (editor mode). */
  onSelectEdge?: (id: string, e: ReactPointerEvent) => void;
  /** Right-click on an edge (editor mode) — opens the edge context menu. */
  onEdgeContextMenu?: (id: string, e: ReactMouseEvent) => void;
  /** Double-click on an edge (editor mode) — opens the inline label editor. */
  onEdgeDoubleClick?: (id: string, e: ReactMouseEvent) => void;
  /** The currently selected edge id, drawn highlighted. */
  selectedId?: string | null;
}

// SVG overlay drawing every edge as a perpendicular-entry bezier with optional
// arrowheads and a midpoint label. Lives inside the world layer, so it shares
// the stage's pan/zoom transform and draws directly in world coordinates. The
// svg itself is zero-sized with `overflow: visible` so paths render outside its
// nominal box. In read-only mode pointer events pass through to the nodes
// beneath; when `onSelectEdge` is given, a transparent thick hit-path makes
// each edge clickable.
export function CanvasEdges({
  nodes,
  edges,
  onSelectEdge,
  onEdgeContextMenu,
  onEdgeDoubleClick,
  selectedId,
}: CanvasEdgesProps) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const interactive = !!onSelectEdge;

  return (
    <svg
      className="glyph-canvas-edges"
      data-interactive={interactive || undefined}
      width={1}
      height={1}
      aria-hidden
    >
      <title>Canvas connections</title>
      {edges.map((edge) => {
        const from = byId.get(edge.fromNode);
        const to = byId.get(edge.toNode);
        if (!from || !to) return null;

        const fromSide = edge.fromSide ?? inferSide(from, to);
        const toSide = edge.toSide ?? inferSide(to, from);
        const start = sideAnchor(from, fromSide);
        const end = sideAnchor(to, toSide);
        const d = bezierPath(start, fromSide, end, toSide);
        const baseColor = canvasColorToCss(edge.color) ?? "var(--glyph-canvas-edge, currentColor)";
        const color = edge.id === selectedId ? "var(--color-accent)" : baseColor;
        const showToArrow = (edge.toEnd ?? "arrow") === "arrow";
        const showFromArrow = (edge.fromEnd ?? "none") === "arrow";

        return (
          <g key={edge.id} stroke={color} fill={color}>
            {interactive && (
              // biome-ignore lint/a11y/noStaticElementInteractions: invisible hit-area widening a decorative (aria-hidden) edge path; keyboard users reach edge actions via selection plus the Delete key and toolbar
              <path
                d={d}
                className="glyph-canvas-edge-hit"
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectEdge?.(edge.id, e);
                }}
                onContextMenu={(e) => onEdgeContextMenu?.(edge.id, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onEdgeDoubleClick?.(edge.id, e);
                }}
              />
            )}
            <path d={d} fill="none" strokeWidth={edge.id === selectedId ? 3 : 2} />
            {showToArrow && <polygon points={arrowheadPoints(end, toSide)} stroke="none" />}
            {showFromArrow && <polygon points={arrowheadPoints(start, fromSide)} stroke="none" />}
            {edge.label && (
              <text
                x={(start.x + end.x) / 2}
                y={(start.y + end.y) / 2}
                className="glyph-canvas-edge-label"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
