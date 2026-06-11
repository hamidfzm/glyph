import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContextMenu, type ContextMenuModel } from "@/components/menu/ContextMenu";
import { useCanvasDocument } from "@/hooks/useCanvasDocument";
import { useCanvasGestures } from "@/hooks/useCanvasGestures";
import { useCanvasViewport } from "@/hooks/useCanvasViewport";
import { edgeMidpoint, inferSide, nodesBoundingBox, type Point } from "@/lib/canvas/geometry";
import {
  addEdge,
  addNode,
  removeEdge,
  removeNodes,
  setNodesColor,
  updateEdgeLabel,
  updateGroupLabel,
  updateLinkUrl,
  updateTextNode,
} from "@/lib/canvas/mutations";
import type { CanvasNode, NodeSide } from "@/lib/canvas/types";
import { screenToWorld } from "@/lib/canvas/viewport";
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

type CreatableType = "text" | "group" | "link";

/** Default sizes for freshly created nodes, per type. */
const NEW_NODE_SIZE: Record<CreatableType, { width: number; height: number }> = {
  text: { width: 250, height: 120 },
  group: { width: 420, height: 300 },
  link: { width: 320, height: 64 },
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `n${Math.round(Math.random() * 1e9)}`;
}

interface CanvasEditorProps {
  content: string;
  filePath?: string;
  /** Persist a finished edit (serialized canvas JSON) into the tab pipeline. */
  onChange: (serialized: string) => void;
}

// Editable canvas board: select, move, resize, recolour, create/delete nodes
// and edges, and edit text inline. The pointer-gesture state machine lives in
// useCanvasGestures; this component owns selection, inline editing, the
// context menu, and the discrete board operations.
export function CanvasEditor({ content, filePath, onChange }: CanvasEditorProps) {
  const { viewport, stageRef, panBy, zoomBy, fitTo, toStagePoint } = useCanvasViewport();
  const { data, setData, commit } = useCanvasDocument(content, onChange);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuModel | null>(null);

  // Deferred callbacks (gestures, menu actions, the Delete-key handler) read
  // the board through this ref so they always act on the current data even
  // when they fire after a re-render they did not observe.
  const dataRef = useRef(data);
  dataRef.current = data;

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
    onStageDown: () => {
      setSelection(new Set());
      setSelectedEdge(null);
      setEditingId(null);
      setEditingEdgeId(null);
    },
    onConnect: (fromId, fromSide, target) => {
      const from = dataRef.current.nodes.find((n) => n.id === fromId);
      const toSide = from
        ? inferSide(target, from)
        : // v8 ignore next -- defensive: from is the connect origin node, always found
          "left";
      commit(
        addEdge(dataRef.current, {
          id: newId(),
          fromNode: fromId,
          fromSide,
          toNode: target.id,
          toSide,
        }),
      );
    },
  });

  // --- selection ---------------------------------------------------------
  const selectNode = (id: string, additive: boolean) => {
    setSelectedEdge(null);
    setSelection((prev) => {
      if (!additive) return prev.has(id) && prev.size === 1 ? prev : new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- discrete operations -----------------------------------------------
  // Create a node centred on `at` (world coordinates), defaulting to the
  // middle of the stage, then immediately open it for inline naming.
  const addNodeAt = (type: CreatableType, at?: Point) => {
    const stage = stageRef.current;
    const center =
      at ??
      (stage
        ? screenToWorld(viewport, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 })
        : // v8 ignore next -- defensive: stageRef is always attached once rendered
          { x: 0, y: 0 });
    const size = NEW_NODE_SIZE[type];
    const id = newId();
    const base = {
      id,
      x: Math.round(center.x - size.width / 2),
      y: Math.round(center.y - size.height / 2),
      ...size,
    };
    const node: CanvasNode =
      type === "text"
        ? { ...base, type, text: "" }
        : type === "group"
          ? { ...base, type }
          : { ...base, type, url: "" };
    commit(addNode(dataRef.current, node));
    setSelection(new Set([id]));
    setEditingId(id);
  };

  const deleteSelection = () => {
    if (selectedEdge) {
      commit(removeEdge(dataRef.current, selectedEdge));
      setSelectedEdge(null);
      /* v8 ignore start -- defensive: toolbar only renders with an edge or node selected */
    } else if (selection.size > 0) {
      /* v8 ignore stop */
      commit(removeNodes(dataRef.current, selection));
      setSelection(new Set());
    }
  };

  const recolor = (color: string | undefined) =>
    commit(setNodesColor(dataRef.current, selection, color));

  const commitText = (id: string, value: string) => {
    const node = dataRef.current.nodes.find((n) => n.id === id);
    /* v8 ignore start -- defensive: id always references a node currently being edited */
    if (node?.type === "text") commit(updateTextNode(dataRef.current, id, value));
    else if (node?.type === "group") commit(updateGroupLabel(dataRef.current, id, value));
    else if (node?.type === "link") commit(updateLinkUrl(dataRef.current, id, value));
    /* v8 ignore stop */
    setEditingId(null);
  };

  const commitEdgeLabel = (id: string, value: string) => {
    // Reads through dataRef: the label editor's commit-on-end can fire from
    // its unmount cleanup, after the render that removed its edge.
    commit(updateEdgeLabel(dataRef.current, id, value));
    setEditingEdgeId(null);
  };

  // Right-click menu. preventDefault marks the event as claimed so the
  // app-level handler leaves it alone; stopPropagation keeps a node's menu
  // from also opening the stage's. Creation lands at the clicked world point.
  const openMenu = (e: ReactMouseEvent, target: CanvasMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const at = worldAt(e);
    const actions: CanvasMenuActions = {
      createNode: (type) => addNodeAt(type, at),
      startEdit: (id) => setEditingId(id),
      editEdgeLabel: (id) => setEditingEdgeId(id),
      setNodeColor: (id, color) => commit(setNodesColor(dataRef.current, new Set([id]), color)),
      deleteNode: (id) => {
        commit(removeNodes(dataRef.current, new Set([id])));
        setSelection(new Set());
      },
      deleteEdge: (id) => {
        commit(removeEdge(dataRef.current, id));
        setSelectedEdge(null);
      },
    };
    setMenu({ x: e.clientX, y: e.clientY, items: buildCanvasMenuItems(target, actions) });
  };

  // Delete/Backspace removes the selection. Bound on the document (like the
  // app's undo/redo shortcut) so the stage needs no tabIndex; ignored while a
  // text field is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (editingId) return;
      const target = e.target as Element | null;
      /* v8 ignore start -- defensive: a focused canvas textarea implies editingId, handled above */
      if (target?.closest("input, textarea, [contenteditable]")) return;
      /* v8 ignore stop */
      if (selectedEdge) {
        e.preventDefault();
        commit(removeEdge(dataRef.current, selectedEdge));
        setSelectedEdge(null);
      } else if (selection.size > 0) {
        e.preventDefault();
        commit(removeNodes(dataRef.current, selection));
        setSelection(new Set());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, selectedEdge, editingId, commit]);

  const boundingBox = useMemo(() => nodesBoundingBox(data.nodes), [data.nodes]);
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
            onSelectEdge={(id) => {
              setSelectedEdge(id);
              setSelection(new Set());
            }}
            onEdgeContextMenu={(id, e) => {
              setSelectedEdge(id);
              setSelection(new Set());
              openMenu(e, { kind: "edge", id });
            }}
            onEdgeDoubleClick={(id) => {
              setSelectedEdge(id);
              setSelection(new Set());
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
