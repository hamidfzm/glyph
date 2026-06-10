// Builds the items for the canvas editor's right-click menu. Pure and free of
// React so the menu contents are easy to unit test: empty board space offers
// node creation, a node offers edit/recolour/delete, an edge offers delete.

import { PRESET_COLORS } from "@/lib/canvas/color";
import type { CanvasNode } from "@/lib/canvas/types";
import type { ContextMenuActionItem, ContextMenuItem } from "@/lib/contextMenuItems";

export type CanvasMenuTarget =
  | { kind: "stage" }
  | { kind: "node"; node: CanvasNode }
  | { kind: "edge"; id: string };

export interface CanvasMenuActions {
  createNode: (type: "text" | "group" | "link") => void;
  startEdit: (id: string) => void;
  setNodeColor: (id: string, color: string | undefined) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
}

/** Human names for the spec's preset colour indices "1"–"6". */
const PRESET_LABELS: Record<string, string> = {
  "1": "Red",
  "2": "Orange",
  "3": "Yellow",
  "4": "Green",
  "5": "Cyan",
  "6": "Purple",
};

const EDIT_LABELS = { text: "Edit text", group: "Edit label", link: "Edit URL" } as const;

export function buildCanvasMenuItems(
  target: CanvasMenuTarget,
  actions: CanvasMenuActions,
): ContextMenuItem[] {
  if (target.kind === "stage") {
    return [
      { kind: "action", label: "New card", onSelect: () => actions.createNode("text") },
      { kind: "action", label: "New group", onSelect: () => actions.createNode("group") },
      { kind: "action", label: "New link", onSelect: () => actions.createNode("link") },
    ];
  }

  if (target.kind === "edge") {
    return [
      {
        kind: "action",
        label: "Delete connection",
        danger: true,
        onSelect: () => actions.deleteEdge(target.id),
      },
    ];
  }

  const { node } = target;
  const items: ContextMenuItem[] = [];
  if (node.type !== "file") {
    items.push({
      kind: "action",
      label: EDIT_LABELS[node.type],
      onSelect: () => actions.startEdit(node.id),
    });
  }
  const swatches: ContextMenuActionItem[] = PRESET_COLORS.map((c) => ({
    kind: "action",
    label: PRESET_LABELS[c],
    onSelect: () => actions.setNodeColor(node.id, c),
  }));
  swatches.push({
    kind: "action",
    label: "Clear colour",
    onSelect: () => actions.setNodeColor(node.id, undefined),
  });
  items.push({ kind: "submenu", label: "Colour", items: swatches });
  items.push({ kind: "separator" });
  items.push({
    kind: "action",
    label: "Delete",
    danger: true,
    onSelect: () => actions.deleteNode(node.id),
  });
  return items;
}
