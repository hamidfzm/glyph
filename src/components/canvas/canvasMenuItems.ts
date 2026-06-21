// Builds the items for the canvas editor's right-click menu. Pure and free of
// React so the menu contents are easy to unit test: empty board space offers
// node creation, a node offers edit/recolour/delete, an edge offers delete.

import type { TFunction } from "i18next";
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
  editEdgeLabel: (id: string) => void;
  setNodeColor: (id: string, color: string | undefined) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
}

/** i18n keys for the spec's preset colour indices "1"–"6". */
const PRESET_LABEL_KEYS: Record<string, string> = {
  "1": "canvasMenu.colorRed",
  "2": "canvasMenu.colorOrange",
  "3": "canvasMenu.colorYellow",
  "4": "canvasMenu.colorGreen",
  "5": "canvasMenu.colorCyan",
  "6": "canvasMenu.colorPurple",
};

const EDIT_LABEL_KEYS = {
  text: "canvasMenu.editText",
  group: "canvasMenu.editGroupLabel",
  link: "canvasMenu.editUrl",
} as const;

export function buildCanvasMenuItems(
  target: CanvasMenuTarget,
  actions: CanvasMenuActions,
  t: TFunction<"common">,
): ContextMenuItem[] {
  if (target.kind === "stage") {
    return [
      {
        kind: "action",
        label: t("canvasMenu.newCard"),
        onSelect: () => actions.createNode("text"),
      },
      {
        kind: "action",
        label: t("canvasMenu.newGroup"),
        onSelect: () => actions.createNode("group"),
      },
      {
        kind: "action",
        label: t("canvasMenu.newLink"),
        onSelect: () => actions.createNode("link"),
      },
    ];
  }

  if (target.kind === "edge") {
    return [
      {
        kind: "action",
        label: t("canvasMenu.editEdgeLabel"),
        onSelect: () => actions.editEdgeLabel(target.id),
      },
      { kind: "separator" },
      {
        kind: "action",
        label: t("canvasMenu.deleteConnection"),
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
      label: t(EDIT_LABEL_KEYS[node.type]),
      onSelect: () => actions.startEdit(node.id),
    });
  }
  const swatches: ContextMenuActionItem[] = PRESET_COLORS.map((c) => ({
    kind: "action",
    label: t(PRESET_LABEL_KEYS[c]),
    onSelect: () => actions.setNodeColor(node.id, c),
  }));
  swatches.push({
    kind: "action",
    label: t("canvasMenu.clearColor"),
    onSelect: () => actions.setNodeColor(node.id, undefined),
  });
  items.push({ kind: "submenu", label: t("canvasMenu.color"), items: swatches });
  items.push({ kind: "separator" });
  items.push({
    kind: "action",
    label: t("canvasMenu.delete"),
    danger: true,
    onSelect: () => actions.deleteNode(node.id),
  });
  return items;
}
