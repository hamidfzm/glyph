import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/types";
import { CanvasEditableNode } from "./CanvasEditableNode";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const textNode: CanvasNode = {
  id: "a",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  text: "hi",
};
const groupNode: CanvasNode = {
  id: "g",
  type: "group",
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  label: "Box",
};
const linkNode: CanvasNode = {
  id: "l",
  type: "link",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  url: "https://x.dev",
};

function setup(over: Partial<React.ComponentProps<typeof CanvasEditableNode>> = {}) {
  const spies = {
    onSelect: vi.fn(),
    onMoveStart: vi.fn(),
    onResizeStart: vi.fn(),
    onConnectStart: vi.fn(),
    onStartEdit: vi.fn(),
    onTextCommit: vi.fn(),
    onEditCancel: vi.fn(),
  };
  const { container } = render(
    <CanvasEditableNode node={textNode} selected={false} editing={false} {...spies} {...over} />,
  );
  return { container, ...spies };
}

describe("CanvasEditableNode", () => {
  it("renders no connectors or resize handle when not selected", () => {
    const { container } = setup({ selected: false });
    expect(container.querySelectorAll(".glyph-canvas-connector")).toHaveLength(0);
    expect(container.querySelector(".glyph-canvas-resize")).toBeNull();
  });

  it("renders four connectors and a resize handle when selected", () => {
    const { container } = setup({ selected: true });
    expect(container.querySelectorAll(".glyph-canvas-connector")).toHaveLength(4);
    expect(container.querySelector(".glyph-canvas-resize")).toBeInTheDocument();
  });

  it("calls onConnectStart with the side when a connector receives pointerDown", () => {
    const { container, onConnectStart } = setup({ selected: true });
    const right = container.querySelector(".glyph-canvas-connector[data-side='right']");
    fireEvent.pointerDown(right!);
    expect(onConnectStart).toHaveBeenCalledTimes(1);
    expect(onConnectStart.mock.calls[0][0]).toBe("right");
  });

  it("calls onResizeStart when the resize handle receives pointerDown", () => {
    const { container, onResizeStart } = setup({ selected: true });
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-resize")!);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect and onMoveStart on node body pointerDown when not editing", () => {
    const { container, onSelect, onMoveStart } = setup();
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-node")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMoveStart).toHaveBeenCalledTimes(1);
  });

  it("does not call onMoveStart on body pointerDown while editing", () => {
    const { container, onSelect, onMoveStart } = setup({ editing: true });
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-node")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMoveStart).not.toHaveBeenCalled();
  });

  it("calls onStartEdit on doubleClick of an editable text node", () => {
    const { container, onStartEdit } = setup();
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-node")!);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it("calls onStartEdit on doubleClick of a link node (URL is editable)", () => {
    const { container, onStartEdit } = setup({ node: linkNode });
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-node")!);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it("does not call onStartEdit on doubleClick of a file node", () => {
    const fileNode: CanvasNode = {
      id: "f",
      type: "file",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      file: "doc.md",
    };
    const { container, onStartEdit } = setup({ node: fileNode });
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-node")!);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("shows the URL in the textarea when editing a link node and commits on plain Enter", () => {
    const { container, onTextCommit } = setup({ node: linkNode, editing: true });
    const ta = container.querySelector<HTMLTextAreaElement>(".glyph-canvas-node-editor")!;
    expect(ta.value).toBe("https://x.dev");
    fireEvent.change(ta, { target: { value: "https://glyph.dev" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onTextCommit).toHaveBeenCalledWith("https://glyph.dev");
  });

  it("wraps content in the clipping wrapper so chrome never causes scrollbars", () => {
    const { container } = setup({ selected: true });
    expect(container.querySelector(".glyph-canvas-node-content")).toBeInTheDocument();
  });

  it("renders a textarea with the text node's text when editing", () => {
    const { container } = setup({ editing: true });
    const ta = container.querySelector<HTMLTextAreaElement>(".glyph-canvas-node-editor");
    expect(ta).toBeInTheDocument();
    expect(ta!.value).toBe("hi");
  });

  it("commits on blur with the textarea value", () => {
    const { container, onTextCommit } = setup({ editing: true });
    const ta = container.querySelector<HTMLTextAreaElement>(".glyph-canvas-node-editor")!;
    fireEvent.change(ta, { target: { value: "changed" } });
    fireEvent.blur(ta);
    expect(onTextCommit).toHaveBeenCalledWith("changed");
  });

  it("cancels on Escape", () => {
    const { container, onEditCancel } = setup({ editing: true });
    const ta = container.querySelector(".glyph-canvas-node-editor")!;
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(onEditCancel).toHaveBeenCalledTimes(1);
  });

  it("commits on Ctrl+Enter", () => {
    const { container, onTextCommit } = setup({ editing: true });
    const ta = container.querySelector(".glyph-canvas-node-editor")!;
    fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });
    expect(onTextCommit).toHaveBeenCalledWith("hi");
  });

  it("commits on Meta+Enter", () => {
    const { container, onTextCommit } = setup({ editing: true });
    const ta = container.querySelector(".glyph-canvas-node-editor")!;
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(onTextCommit).toHaveBeenCalledWith("hi");
  });

  it("does not commit or cancel on a plain Enter", () => {
    const { container, onTextCommit, onEditCancel } = setup({ editing: true });
    const ta = container.querySelector(".glyph-canvas-node-editor")!;
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onTextCommit).not.toHaveBeenCalled();
    expect(onEditCancel).not.toHaveBeenCalled();
  });

  it("stops propagation on textarea pointerDown without selecting", () => {
    const { container, onSelect } = setup({ editing: true });
    const ta = container.querySelector(".glyph-canvas-node-editor")!;
    fireEvent.pointerDown(ta);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the group label in the textarea when editing a group node", () => {
    const { container } = setup({ node: groupNode, editing: true });
    const ta = container.querySelector<HTMLTextAreaElement>(".glyph-canvas-node-editor")!;
    expect(ta.value).toBe("Box");
  });

  it("shows an empty textarea when editing a group node without a label", () => {
    const noLabel: CanvasNode = { id: "g2", type: "group", x: 0, y: 0, width: 200, height: 120 };
    const { container } = setup({ node: noLabel, editing: true });
    const ta = container.querySelector<HTMLTextAreaElement>(".glyph-canvas-node-editor")!;
    expect(ta.value).toBe("");
  });
});
