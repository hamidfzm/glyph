import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import {
  flushMicrotasks,
  lastData,
  nodesOf,
  oneText,
  stageOf,
  twoNodes,
  withEdge,
} from "@/test/fixtures/canvas";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("CanvasEditor inline editing", () => {
  it("edits a text node inline and commits on blur", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.doubleClick(node);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "Edited" } });
    fireEvent.blur(textarea);
    expect(lastData(onChange).nodes[0]).toMatchObject({ text: "Edited" });
  });

  it("renders a group node and edits its label inline", () => {
    const onChange = vi.fn();
    const groupContent = JSON.stringify({
      nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 400, height: 300, label: "Area" }],
      edges: [],
    });
    const { container } = render(<CanvasEditor content={groupContent} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.doubleClick(node);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Renamed" } });
    fireEvent.blur(textarea);
    expect(lastData(onChange).nodes[0]).toMatchObject({ type: "group", label: "Renamed" });
  });

  it("clicking the canvas background while editing commits the typed text", async () => {
    // Regression: unmounting a focused textarea fires no blur event, so
    // ending an edit via the stage used to silently drop the typed content.
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.doubleClick(nodesOf(container)[0]);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Typed then clicked away" } });
    fireEvent.pointerDown(stageOf(container), { clientX: 500, clientY: 400, button: 0 });
    await flushMicrotasks();
    expect(lastData(onChange).nodes[0]).toMatchObject({ text: "Typed then clicked away" });
  });

  it("unmounting the editor mid-edit commits the pending text", async () => {
    // Same loss path when the tab switches to view mode while typing.
    const onChange = vi.fn();
    const { container, unmount } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.doubleClick(nodesOf(container)[0]);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Typed then switched mode" } });
    unmount();
    await flushMicrotasks();
    expect(onChange).toHaveBeenCalled();
    const data = lastData(onChange);
    expect(data.nodes[0]).toMatchObject({ text: "Typed then switched mode" });
  });

  it("double-clicking another card mid-edit commits the first card's text", async () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a, b] = nodesOf(container);
    fireEvent.doubleClick(a);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "First card edit" } });
    fireEvent.doubleClick(b);
    await flushMicrotasks();
    expect(lastData(onChange).nodes[0]).toMatchObject({ text: "First card edit" });
  });

  it("cancels an inline edit on Escape without committing", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.doubleClick(node);
    const textarea = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Discarded" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".glyph-canvas-node-editor")).toBeNull();
  });

  it("double-clicking an edge opens the label editor; Enter commits the label", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "depends on" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastData(onChange).edges[0]).toMatchObject({ label: "depends on" });
  });

  it("clicking the stage while editing an edge label commits it", async () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "spec" } });
    fireEvent.pointerDown(stageOf(container), { clientX: 600, clientY: 500, button: 0 });
    await flushMicrotasks();
    expect(lastData(onChange).edges[0]).toMatchObject({ label: "spec" });
  });

  it("Escape discards an edge label edit", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeNull();
  });

  it("clears an edge label by committing an empty value", () => {
    const onChange = vi.fn();
    const labelled = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "A" },
        { id: "b", type: "text", x: 300, y: 0, width: 200, height: 80, text: "B" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", label: "old" }],
    });
    const { container } = render(<CanvasEditor content={labelled} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
    expect(input.value).toBe("old");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastData(onChange).edges[0]).not.toHaveProperty("label");
  });

  it("deleting the edge while its label editor is open closes the editor", async () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeTruthy();
    // The edge vanishes out from under the editor; the editing id briefly
    // points at a no-longer-existing edge, which must render as "no editor".
    fireEvent.contextMenu(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete connection" }));
    // The unmounted editor's deferred cleanup still runs; flush it inside act.
    await flushMicrotasks();
    expect(lastData(onChange).edges).toHaveLength(0);
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeNull();
  });

  it("double-clicking a card opens its editor without creating a new card", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.doubleClick(nodesOf(container)[0]);
    expect(container.querySelector(".glyph-canvas-node-editor")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(nodesOf(container)).toHaveLength(1);
  });

  it("ignores Delete while a node is being edited", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.doubleClick(node);
    expect(container.querySelector(".glyph-canvas-node-editor")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
    // Node is still present (not deleted).
    expect(nodesOf(container)).toHaveLength(1);
  });

  it("ignores Delete when nothing is selected", () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
