import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/types";
import type { ContextMenuActionItem, ContextMenuItem } from "@/lib/contextMenuItems";
import { buildCanvasMenuItems, type CanvasMenuActions } from "./canvasMenuItems";

const makeActions = (): CanvasMenuActions => ({
  createNode: vi.fn(),
  startEdit: vi.fn(),
  setNodeColor: vi.fn(),
  deleteNode: vi.fn(),
  deleteEdge: vi.fn(),
});

const labels = (items: ContextMenuItem[]) =>
  items.map((i) => (i.kind === "separator" ? "—" : i.label));

const textNode: CanvasNode = { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "" };

describe("buildCanvasMenuItems", () => {
  it("offers node creation on empty board space", () => {
    const actions = makeActions();
    const items = buildCanvasMenuItems({ kind: "stage" }, actions);
    expect(labels(items)).toEqual(["New card", "New group", "New link"]);
    (items[1] as ContextMenuActionItem).onSelect();
    expect(actions.createNode).toHaveBeenCalledWith("group");
  });

  it("offers edit, colour, and delete for a text node", () => {
    const actions = makeActions();
    const items = buildCanvasMenuItems({ kind: "node", node: textNode }, actions);
    expect(labels(items)).toEqual(["Edit text", "Colour", "—", "Delete"]);
    (items[0] as ContextMenuActionItem).onSelect();
    expect(actions.startEdit).toHaveBeenCalledWith("a");
    (items[3] as ContextMenuActionItem).onSelect();
    expect(actions.deleteNode).toHaveBeenCalledWith("a");
  });

  it("labels the edit entry per node type and omits it for files", () => {
    const actions = makeActions();
    const group: CanvasNode = { id: "g", type: "group", x: 0, y: 0, width: 10, height: 10 };
    const link: CanvasNode = { id: "l", type: "link", x: 0, y: 0, width: 10, height: 10, url: "" };
    const file: CanvasNode = {
      id: "f",
      type: "file",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      file: "a.md",
    };
    expect(labels(buildCanvasMenuItems({ kind: "node", node: group }, actions))[0]).toBe(
      "Edit label",
    );
    expect(labels(buildCanvasMenuItems({ kind: "node", node: link }, actions))[0]).toBe("Edit URL");
    expect(labels(buildCanvasMenuItems({ kind: "node", node: file }, actions))).toEqual([
      "Colour",
      "—",
      "Delete",
    ]);
  });

  it("colour submenu carries the six presets plus clear", () => {
    const actions = makeActions();
    const items = buildCanvasMenuItems({ kind: "node", node: textNode }, actions);
    const colour = items.find((i) => i.kind === "submenu");
    expect(colour?.kind).toBe("submenu");
    if (colour?.kind !== "submenu") throw new Error("missing submenu");
    expect(colour.items.map((i) => i.label)).toEqual([
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Cyan",
      "Purple",
      "Clear colour",
    ]);
    colour.items[2].onSelect();
    expect(actions.setNodeColor).toHaveBeenCalledWith("a", "3");
    colour.items[6].onSelect();
    expect(actions.setNodeColor).toHaveBeenCalledWith("a", undefined);
  });

  it("offers delete for an edge", () => {
    const actions = makeActions();
    const items = buildCanvasMenuItems({ kind: "edge", id: "e1" }, actions);
    expect(labels(items)).toEqual(["Delete connection"]);
    (items[0] as ContextMenuActionItem).onSelect();
    expect(actions.deleteEdge).toHaveBeenCalledWith("e1");
  });
});
