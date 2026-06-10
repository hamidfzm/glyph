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
import { useCanvasViewport } from "@/hooks/useCanvasViewport";
import {
  inferSide,
  nodeAtPoint,
  nodeIdsInGroup,
  nodesBoundingBox,
  type Point,
  sideAnchor,
} from "@/lib/canvas/geometry";
import {
  addEdge,
  addNode,
  moveNodes,
  removeEdge,
  removeNodes,
  resizeNode,
  setNodesColor,
  updateGroupLabel,
  updateLinkUrl,
  updateTextNode,
} from "@/lib/canvas/mutations";
import type { CanvasData, CanvasNode, NodeSide } from "@/lib/canvas/types";
import { screenToWorld } from "@/lib/canvas/viewport";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasEditableNode } from "./CanvasEditableNode";
import { CanvasSelectionToolbar } from "./CanvasSelectionToolbar";
import {
  buildCanvasMenuItems,
  type CanvasMenuActions,
  type CanvasMenuTarget,
} from "./canvasMenuItems";

const MIN_SIZE = 60;

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

type Gesture = (
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "move"; start: Point; base: CanvasData; ids: ReadonlySet<string>; latest: CanvasData }
  | { kind: "resize"; id: string; start: Point; base: CanvasData; latest: CanvasData }
  | { kind: "connect"; fromId: string; fromSide: NodeSide }
) & {
  /** Set once the pointer is captured (deferred to the first real movement). */
  captured?: boolean;
};

interface CanvasEditorProps {
  content: string;
  filePath?: string;
  /** Persist a finished edit (serialized canvas JSON) into the tab pipeline. */
  onChange: (serialized: string) => void;
}

// Editable canvas board: select, move, resize, recolour, create/delete nodes
// and edges, and edit text inline. Live drag/resize frames update local state
// only; each finished gesture (or discrete op) is committed once, so undo/redo
// and autosave see one entry per action.
export function CanvasEditor({ content, filePath, onChange }: CanvasEditorProps) {
  const { viewport, stageRef, panBy, zoomBy, fitTo, toStagePoint } = useCanvasViewport();
  const { data, setData, commit } = useCanvasDocument(content, onChange);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempEdge, setTempEdge] = useState<{ from: Point; to: Point } | null>(null);
  const [menu, setMenu] = useState<ContextMenuModel | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const worldAt = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(viewport, toStagePoint(e.clientX, e.clientY));

  // Pointer capture is deferred until the first real movement of a gesture.
  // Capturing on pointerdown retargets the browser's compatibility mouse
  // events (including dblclick) to the stage, so double-clicking a card would
  // fire the stage's create-card handler instead of opening the card's inline
  // editor. A clean double-click never moves, so it never captures.
  const captureOnFirstMove = (g: Gesture, e: ReactPointerEvent) => {
    if (g.captured) return;
    g.captured = true;
    stageRef.current?.setPointerCapture?.(e.pointerId);
  };

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

  // --- gesture starts (invoked from nodes) -------------------------------
  const startMove = (id: string, e: ReactPointerEvent) => {
    let ids: ReadonlySet<string>;
    if (selection.has(id)) {
      ids = selection;
    } else {
      const node = dataRef.current.nodes.find((n) => n.id === id);
      // Dragging a group carries everything inside its bounds along with it —
      // that containment is what makes a group a group rather than a card.
      ids =
        node?.type === "group"
          ? new Set([id, ...nodeIdsInGroup(dataRef.current.nodes, node)])
          : new Set([id]);
    }
    gesture.current = {
      kind: "move",
      start: worldAt(e),
      base: dataRef.current,
      ids,
      latest: dataRef.current,
    };
  };

  const startResize = (id: string, e: ReactPointerEvent) => {
    gesture.current = {
      kind: "resize",
      id,
      start: worldAt(e),
      base: dataRef.current,
      latest: dataRef.current,
    };
  };

  const startConnect = (fromId: string, side: NodeSide, e: ReactPointerEvent) => {
    const node = dataRef.current.nodes.find((n) => n.id === fromId);
    /* v8 ignore start -- defensive: connect starts from a rendered node, always found */
    if (!node) return;
    /* v8 ignore stop */
    gesture.current = { kind: "connect", fromId, fromSide: side };
    setTempEdge({ from: sideAnchor(node, side), to: worldAt(e) });
  };

  // --- stage pointer handling --------------------------------------------
  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelection(new Set());
    setSelectedEdge(null);
    setEditingId(null);
    gesture.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
  };

  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
      setData(g.latest);
    } else if (g.kind === "resize") {
      const w = worldAt(e);
      const node = g.base.nodes.find((n) => n.id === g.id);
      /* v8 ignore start -- defensive: resize id always references an existing node */
      if (!node) return;
      /* v8 ignore stop */
      const width = Math.max(MIN_SIZE, node.width + (w.x - g.start.x));
      const height = Math.max(MIN_SIZE, node.height + (w.y - g.start.y));
      g.latest = resizeNode(g.base, g.id, { x: node.x, y: node.y, width, height });
      setData(g.latest);
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

  const onStagePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.captured) stageRef.current?.releasePointerCapture?.(e.pointerId);
    if ((g.kind === "move" || g.kind === "resize") && g.latest !== g.base) {
      commit(g.latest);
    } else if (g.kind === "connect") {
      const target = nodeAtPoint(dataRef.current.nodes, worldAt(e), new Set([g.fromId]));
      if (target) {
        const from = dataRef.current.nodes.find((n) => n.id === g.fromId);
        const toSide = from
          ? inferSide(target, from)
          : // v8 ignore next -- defensive: from is the connect origin node, always found
            "left";
        commit(
          addEdge(dataRef.current, {
            id: newId(),
            fromNode: g.fromId,
            fromSide: g.fromSide,
            toNode: target.id,
            toSide,
          }),
        );
      }
      setTempEdge(null);
    }
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

  const nodeHandlers = (node: CanvasNode) => ({
    selected: selection.has(node.id),
    editing: editingId === node.id,
    onSelect: (e: ReactPointerEvent) => selectNode(node.id, e.shiftKey),
    onMoveStart: (e: ReactPointerEvent) => startMove(node.id, e),
    onResizeStart: (e: ReactPointerEvent) => startResize(node.id, e),
    onConnectStart: (side: NodeSide, e: ReactPointerEvent) => startConnect(node.id, side, e),
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
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
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
          />

          {tempEdge && (
            <svg className="glyph-canvas-edges" width={1} height={1} aria-hidden>
              <title>New connection</title>
              <line
                x1={tempEdge.from.x}
                y1={tempEdge.from.y}
                x2={tempEdge.to.x}
                y2={tempEdge.to.y}
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

      <div className="glyph-canvas-toolbar">
        <button type="button" onClick={() => addNodeAt("text")} aria-label="Add card">
          + Card
        </button>
        <button type="button" onClick={() => addNodeAt("group")} aria-label="Add group">
          + Group
        </button>
        <button type="button" onClick={() => addNodeAt("link")} aria-label="Add link">
          + Link
        </button>
        <span className="glyph-canvas-toolbar-sep" />
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <span className="glyph-canvas-zoom-level">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => fitTo(boundingBox)} aria-label="Fit to content">
          Fit
        </button>
      </div>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
