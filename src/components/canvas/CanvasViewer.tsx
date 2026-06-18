import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCanvasViewport } from "@/hooks/useCanvasViewport";
import { canvasColorToCss } from "@/lib/canvas/color";
import { nodesBoundingBox } from "@/lib/canvas/geometry";
import { updateTextNode } from "@/lib/canvas/mutations";
import { parseCanvas } from "@/lib/canvas/parse";
import { serializeCanvas } from "@/lib/canvas/serialize";
import { CanvasParseError } from "@/lib/canvas/types";
import { toggleTaskAtLine } from "@/lib/taskList";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasNodeView } from "./CanvasNodeView";
import { CanvasToolbar } from "./CanvasToolbar";

interface CanvasViewerProps {
  content: string;
  filePath?: string;
  /** Opened workspace root; constrains resolved file refs to the folder. */
  workspaceRoot?: string;
  onOpenFile?: (path: string) => void;
  /** Persist a checkbox toggle (the only edit view mode allows). */
  onChange?: (serialized: string) => void;
  /** Keeps the pan/zoom transform across view/edit mode switches. */
  viewportKey?: string;
}

// Read-only canvas stage: parses the .canvas content, lays nodes out in an
// infinite pan/zoom world, and draws edges between them. Groups render behind
// edges, edges behind nodes. Editing interactions are layered on separately.
export function CanvasViewer({
  content,
  filePath,
  workspaceRoot,
  onOpenFile,
  onChange,
  viewportKey,
}: CanvasViewerProps) {
  const { viewport, restored, stageRef, panBy, zoomBy, fitTo } = useCanvasViewport(viewportKey);

  const parsed = useMemo(() => {
    try {
      return { data: parseCanvas(content), error: null as string | null };
    } catch (err) {
      return {
        data: null,
        error:
          err instanceof CanvasParseError
            ? err.message
            : // v8 ignore next -- defensive: parseCanvas only throws CanvasParseError
              String(err),
      };
    }
  }, [content]);

  const data = parsed.data;
  const boundingBox = useMemo(() => (data ? nodesBoundingBox(data.nodes) : null), [data]);

  // Fit the board to the viewport once, after the first successful parse —
  // unless a persisted viewport was restored, in which case the user's last
  // viewpoint wins over a recentre.
  const didFit = useRef(restored);
  useEffect(() => {
    if (data && !didFit.current) {
      didFit.current = true;
      fitTo(boundingBox);
    }
  }, [data, boundingBox, fitTo]);

  // Background drag-to-pan. Node clicks stop propagation so they don't pan.
  const panState = useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    panState.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const last = panState.current;
    if (!last) return;
    panBy(e.clientX - last.x, e.clientY - last.y);
    panState.current = { x: e.clientX, y: e.clientY };
  };
  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    panState.current = null;
    setPanning(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  if (parsed.error) {
    return (
      <div className="glyph-canvas-error" role="alert">
        <p>This canvas couldn't be opened.</p>
        <code>{parsed.error}</code>
      </div>
    );
  }
  /* v8 ignore start -- defensive: data is null only when parsed.error is set, handled above */
  if (!data) return null;
  /* v8 ignore stop */

  const groups = data.nodes.filter((n) => n.type === "group");
  const items = data.nodes.filter((n) => n.type !== "group");

  return (
    <div className="glyph-canvas">
      <div
        ref={stageRef}
        className="glyph-canvas-stage"
        data-panning={panning || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="glyph-canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {groups.map((node) => (
            <div
              key={node.id}
              className="glyph-canvas-group"
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                borderColor: canvasColorToCss(node.color),
              }}
            >
              <CanvasNodeView
                node={node}
                canvasPath={filePath}
                workspaceRoot={workspaceRoot}
                onOpenFile={onOpenFile}
              />
            </div>
          ))}

          <CanvasEdges nodes={data.nodes} edges={data.edges} />

          {items.map((node) => (
            <div
              key={node.id}
              className="glyph-canvas-node"
              data-type={node.type}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                borderColor: canvasColorToCss(node.color),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="glyph-canvas-node-content">
                <CanvasNodeView
                  node={node}
                  canvasPath={filePath}
                  workspaceRoot={workspaceRoot}
                  onOpenFile={onOpenFile}
                  onTaskToggle={
                    onChange && node.type === "text"
                      ? (line) =>
                          onChange(
                            serializeCanvas(
                              updateTextNode(data, node.id, toggleTaskAtLine(node.text, line)),
                            ),
                          )
                      : undefined
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <CanvasToolbar
        zoom={viewport.zoom}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onFit={() => fitTo(boundingBox)}
      />
    </div>
  );
}
