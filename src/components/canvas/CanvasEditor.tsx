import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuModel } from "@/components/menu/ContextMenu";
import { useCanvasDocument } from "@/hooks/useCanvasDocument";
import { useCanvasEditing } from "@/hooks/useCanvasEditing";
import { useCanvasGestures } from "@/hooks/useCanvasGestures";
import { useCanvasViewport } from "@/hooks/useCanvasViewport";
import { edgeMidpoint, inferSide, nodesBoundingBox, type Point } from "@/lib/canvas/geometry";
import { newCanvasId } from "@/lib/canvas/ids";
import { addEdge, updateTextNode } from "@/lib/canvas/mutations";
import type { CanvasNode, NodeSide } from "@/lib/canvas/types";
import { screenToWorld } from "@/lib/canvas/viewport";
import { toggleTaskAtLine } from "@/lib/taskList";
import { CanvasEdgeLabelEditor } from "./CanvasEdgeLabelEditor";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasEditableNode } from "./CanvasEditableNode";
import { CanvasSelectionToolbar } from "./CanvasSelectionToolbar";
import { CanvasToolbar } from "./CanvasToolbar";
import {
  buildCanvasMenuItems,
  type CanvasMenuActions,
  type CanvasMenuTarget,
} from "./canvasMenuItems";

interface CanvasEditorProps {
  content: string;
  filePath?: string;
  /** Persist a finished edit (serialized canvas JSON) into the tab pipeline. */
  onChange: (serialized: string) => void;
  /** Keeps the pan/zoom transform across view/edit mode switches. */
  viewportKey?: string;
}

// Editable canvas board: select, move, resize, recolour, create/delete nodes
// and edges, and edit text inline. The pointer-gesture state machine lives in
// useCanvasGestures and the selection plus discrete operations in
// useCanvasEditing; this component wires them to the stage and the toolbars.
export function CanvasEditor({ content, filePath, onChange, viewportKey }: CanvasEditorProps) {
  const { t } = useTranslation("common");
  const { viewport, restored, stageRef, panBy, zoomBy, fitTo, toStagePoint } =
    useCanvasViewport(viewportKey);
  const { data, setData, commit } = useCanvasDocument(content, onChange);
  const [menu, setMenu] = useState<ContextMenuModel | null>(null);

  const {
    dataRef,
    selection,
    selectedEdge,
    editingId,
    editingEdgeId,
    setEditingId,
    setEditingEdgeId,
    clearSelection,
    selectNode,
    selectEdge,
    addNodeAt,
    deleteNode,
    deleteEdge,
    deleteSelection,
    recolor,
    setNodeColor,
    commitText,
    commitEdgeLabel,
  } = useCanvasEditing({ data, commit, viewport, stageRef });

  const worldAt = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(viewport, toStagePoint(e.clientX, e.clientY));

  const gestures = useCanvasGestures({
    stageRef,
    worldAt,
    panBy,
    getData: () => dataRef.current,
    setLive: setData,
    commit,
    selection,
    onStageDown: clearSelection,
    onConnect: (fromId, fromSide, target) => {
      const from = dataRef.current.nodes.find((n) => n.id === fromId);
      const toSide = from
        ? inferSide(target, from)
        : // v8 ignore next -- defensive: from is the connect origin node, always found
          "left";
      commit(
        addEdge(dataRef.current, {
          id: newCanvasId(),
          fromNode: fromId,
          fromSide,
          toNode: target.id,
          toSide,
        }),
      );
    },
  });

  // Right-click menu. preventDefault marks the event as claimed so the
  // app-level handler leaves it alone; stopPropagation keeps a node's menu
  // from also opening the stage's. Creation lands at the clicked world point.
  const openMenu = (e: ReactMouseEvent, target: CanvasMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const at = worldAt(e);
    const actions: CanvasMenuActions = {
      createNode: (type) => addNodeAt(type, at),
      startEdit: setEditingId,
      editEdgeLabel: setEditingEdgeId,
      setNodeColor,
      deleteNode,
      deleteEdge,
    };
    setMenu({ x: e.clientX, y: e.clientY, items: buildCanvasMenuItems(target, actions, t) });
  };

  const boundingBox = useMemo(() => nodesBoundingBox(data.nodes), [data.nodes]);

  // Fit the board once on mount — unless a persisted viewport was restored
  // (switching from view mode keeps the user's viewpoint instead).
  const didFit = useRef(restored);
  useEffect(() => {
    if (!didFit.current) {
      didFit.current = true;
      fitTo(boundingBox);
    }
  }, [boundingBox, fitTo]);

  const groups = data.nodes.filter((n) => n.type === "group");
  const items = data.nodes.filter((n) => n.type !== "group");
  const editingEdge = editingEdgeId
    ? (data.edges.find((ed) => ed.id === editingEdgeId) ?? null)
    : null;
  const editingEdgeAt = editingEdge ? edgeMidpoint(data.nodes, editingEdge) : null;

  const nodeHandlers = (node: CanvasNode) => ({
    selected: selection.has(node.id),
    editing: editingId === node.id,
    onSelect: (e: ReactPointerEvent) => selectNode(node.id, e.shiftKey),
    onMoveStart: (e: ReactPointerEvent) => gestures.startMove(node.id, e),
    onResizeStart: (e: ReactPointerEvent) => gestures.startResize(node.id, e),
    onConnectStart: (side: NodeSide, e: ReactPointerEvent) =>
      gestures.startConnect(node.id, side, e),
    onStartEdit: () => setEditingId(node.id),
    onTextCommit: (v: string) => commitText(node.id, v),
    onEditCancel: () => setEditingId(null),
    onContextMenu: (e: ReactMouseEvent) => {
      selectNode(node.id, false);
      openMenu(e, { kind: "node", node });
    },
    onTaskToggle: (line: number) => {
      const current = dataRef.current.nodes.find((n) => n.id === node.id);
      /* v8 ignore start -- defensive: checkboxes only render inside text cards */
      if (current?.type !== "text") return;
      /* v8 ignore stop */
      commit(updateTextNode(dataRef.current, node.id, toggleTaskAtLine(current.text, line)));
    },
  });

  return (
    <div className="glyph-canvas" data-editing>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the stage is a custom spatial surface (pan by drag, double-click to create); keyboard users create nodes via the toolbar buttons below */}
      <div
        ref={stageRef}
        className="glyph-canvas-stage"
        {...gestures.stageHandlers}
        onDoubleClick={(e) => addNodeAt("text", worldAt(e))}
        onContextMenu={(e) => openMenu(e, { kind: "stage" })}
      >
        <div
          className="glyph-canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {groups.map((node) => (
            <CanvasEditableNode
              key={node.id}
              node={node}
              canvasPath={filePath}
              {...nodeHandlers(node)}
            />
          ))}

          <CanvasEdges
            nodes={data.nodes}
            edges={data.edges}
            selectedId={selectedEdge}
            onSelectEdge={selectEdge}
            onEdgeContextMenu={(id, e) => {
              selectEdge(id);
              openMenu(e, { kind: "edge", id });
            }}
            onEdgeDoubleClick={(id) => {
              selectEdge(id);
              setEditingEdgeId(id);
            }}
          />

          {editingEdge && editingEdgeAt && (
            <CanvasEdgeLabelEditor
              at={editingEdgeAt}
              initial={editingEdge.label ?? ""}
              onCommit={(v) => commitEdgeLabel(editingEdge.id, v)}
              onCancel={() => setEditingEdgeId(null)}
            />
          )}

          {gestures.tempEdge && (
            <svg className="glyph-canvas-edges" width={1} height={1} aria-hidden>
              <title>New connection</title>
              <line
                x1={gestures.tempEdge.from.x}
                y1={gestures.tempEdge.from.y}
                x2={gestures.tempEdge.to.x}
                y2={gestures.tempEdge.to.y}
                className="glyph-canvas-temp-edge"
              />
            </svg>
          )}

          {items.map((node) => (
            <CanvasEditableNode
              key={node.id}
              node={node}
              canvasPath={filePath}
              {...nodeHandlers(node)}
            />
          ))}
        </div>
      </div>

      {(selection.size > 0 || selectedEdge) && (
        <CanvasSelectionToolbar
          count={selection.size}
          onSetColor={selectedEdge ? () => undefined : recolor}
          onDelete={deleteSelection}
        />
      )}

      <CanvasToolbar
        zoom={viewport.zoom}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onFit={() => fitTo(boundingBox)}
        onAdd={addNodeAt}
      />

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
