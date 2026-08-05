import { type RefObject, useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/canvas/geometry";
import { newCanvasId } from "@/lib/canvas/ids";
import {
  addNode,
  removeEdge,
  removeNodes,
  setNodesColor,
  updateEdgeLabel,
  updateGroupLabel,
  updateLinkUrl,
  updateTextNode,
} from "@/lib/canvas/mutations";
import type { CanvasData, CanvasNode } from "@/lib/canvas/types";
import { screenToWorld, type Viewport } from "@/lib/canvas/viewport";

export type CreatableType = "text" | "group" | "link";

/** Default sizes for freshly created nodes, per type. */
const NEW_NODE_SIZE: Record<CreatableType, { width: number; height: number }> = {
  text: { width: 250, height: 120 },
  group: { width: 420, height: 300 },
  link: { width: 320, height: 64 },
};

interface UseCanvasEditingOptions {
  data: CanvasData;
  commit: (next: CanvasData) => void;
  viewport: Viewport;
  stageRef: RefObject<HTMLDivElement | null>;
}

/**
 * What is selected or being edited on the board, plus the discrete operations
 * that act on it: create, delete, recolour, and commit inline text. Pointer
 * gestures live in `useCanvasGestures`.
 */
export function useCanvasEditing({ data, commit, viewport, stageRef }: UseCanvasEditingOptions) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  // Deferred callbacks (gestures, menu actions, the Delete-key handler) read
  // the board through this ref so they always act on the current data even
  // when they fire after a re-render they did not observe.
  const dataRef = useRef(data);
  dataRef.current = data;

  const clearSelection = () => {
    setSelection(new Set());
    setSelectedEdge(null);
    setEditingId(null);
    setEditingEdgeId(null);
  };

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

  const selectEdge = (id: string) => {
    setSelectedEdge(id);
    setSelection(new Set());
  };

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
    const id = newCanvasId();
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

  const deleteNode = (id: string) => {
    commit(removeNodes(dataRef.current, new Set([id])));
    setSelection(new Set());
  };

  const deleteEdge = (id: string) => {
    commit(removeEdge(dataRef.current, id));
    setSelectedEdge(null);
  };

  const deleteSelection = () => {
    if (selectedEdge) {
      deleteEdge(selectedEdge);
      /* v8 ignore start -- defensive: toolbar only renders with an edge or node selected */
    } else if (selection.size > 0) {
      /* v8 ignore stop */
      commit(removeNodes(dataRef.current, selection));
      setSelection(new Set());
    }
  };

  const recolor = (color: string | undefined) =>
    commit(setNodesColor(dataRef.current, selection, color));

  const setNodeColor = (id: string, color: string | undefined) =>
    commit(setNodesColor(dataRef.current, new Set([id]), color));

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

  // Delete/Backspace removes the selection. Bound on the document (like the
  // app's undo/redo shortcut) so the stage needs no tabIndex; ignored while a
  // text field is focused.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
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
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selection, selectedEdge, editingId, commit]);

  return {
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
  };
}
