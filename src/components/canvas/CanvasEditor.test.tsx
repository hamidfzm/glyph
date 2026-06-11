import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseCanvas } from "@/lib/canvas/parse";
import { CanvasEditor } from "./CanvasEditor";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const empty = JSON.stringify({ nodes: [], edges: [] });
const oneText = JSON.stringify({
  nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "Hello" }],
  edges: [],
});
const twoNodes = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "A" },
    { id: "b", type: "text", x: 300, y: 0, width: 200, height: 80, text: "B" },
  ],
  edges: [],
});
const withEdge = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "A" },
    { id: "b", type: "text", x: 300, y: 0, width: 200, height: 80, text: "B" },
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b" }],
});

// Commit-on-end is deferred one microtask (StrictMode-safe cleanup), so
// tests ending an edit indirectly must flush before asserting.
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const lastData = (onChange: ReturnType<typeof vi.fn>) =>
  parseCanvas(onChange.mock.calls.at(-1)?.[0] as string);
const stageOf = (c: HTMLElement) => c.querySelector(".glyph-canvas-stage") as Element;
const nodesOf = (c: HTMLElement) => Array.from(c.querySelectorAll(".glyph-canvas-node"));

describe("CanvasEditor", () => {
  it("renders existing node content", () => {
    render(<CanvasEditor content={oneText} onChange={vi.fn()} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("adds a card and commits serialized JSON with one text node", () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={empty} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Add card"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const data = lastData(onChange);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].type).toBe("text");
  });

  it("exposes zoom and add-card controls", () => {
    render(<CanvasEditor content={empty} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Add card")).toBeInTheDocument();
    expect(screen.getByLabelText("Fit to content")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Fit to content"));
  });

  it("moves a node by dragging it", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 40, clientY: 25 });
    fireEvent.pointerUp(stageOf(container), { clientX: 40, clientY: 25 });
    expect(onChange).toHaveBeenCalled();
    expect(lastData(onChange).nodes[0]).toMatchObject({ x: 40, y: 25 });
  });

  it("resizes a selected node via its corner handle", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    // Select (down + up with no move) so the resize handle appears.
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    const handle = container.querySelector(".glyph-canvas-resize") as Element;
    expect(handle).toBeTruthy();
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 50, clientY: 30 });
    fireEvent.pointerUp(stageOf(container), { clientX: 50, clientY: 30 });
    expect(lastData(onChange).nodes[0]).toMatchObject({ width: 250, height: 110 });
  });

  it("draws an edge by dragging from a connector onto another node", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a] = nodesOf(container);
    // Select node A to reveal its connectors.
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    const connector = container.querySelector(
      '.glyph-canvas-connector[data-side="right"]',
    ) as Element;
    fireEvent.pointerDown(connector, { clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 350, clientY: 40 });
    // Release over node B (which spans x 300..500, y 0..80).
    fireEvent.pointerUp(stageOf(container), { clientX: 350, clientY: 40 });
    const data = lastData(onChange);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]).toMatchObject({ fromNode: "a", toNode: "b", fromSide: "right" });
  });

  it("does not create an edge when released over empty space", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a] = nodesOf(container);
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    onChange.mockClear();
    const connector = container.querySelector(
      '.glyph-canvas-connector[data-side="right"]',
    ) as Element;
    fireEvent.pointerDown(connector, { clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 800, clientY: 800 });
    fireEvent.pointerUp(stageOf(container), { clientX: 800, clientY: 800 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes the selected node with the Delete key", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(lastData(onChange).nodes).toHaveLength(0);
  });

  it("shift-clicks to select multiple nodes, then deletes them together", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a, b] = nodesOf(container);
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.pointerDown(b, { clientX: 300, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerUp(stageOf(container), { clientX: 300, clientY: 0 });
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(lastData(onChange).nodes).toHaveLength(0);
  });

  it("recolours the selection via the toolbar", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByLabelText("Colour 3"));
    expect(lastData(onChange).nodes[0]).toMatchObject({ color: "3" });
  });

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

  it("selects an edge and deletes it", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    const hit = container.querySelector(".glyph-canvas-edge-hit") as Element;
    fireEvent.pointerDown(hit);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(lastData(onChange).edges).toHaveLength(0);
  });

  it("deletes the selected node via the toolbar Delete button", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByText("Delete"));
    expect(lastData(onChange).nodes).toHaveLength(0);
  });

  it("deletes the selected edge via the toolbar Delete button", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByText("Delete"));
    expect(lastData(onChange).edges).toHaveLength(0);
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

  it("does not recolour when only an edge is selected", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-edge-hit") as Element);
    // Toolbar is shown for the selected edge; clicking a swatch is a no-op.
    fireEvent.click(screen.getByLabelText("Colour 1"));
    expect(onChange).not.toHaveBeenCalled();
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
    const data = parseCanvas(onChange.mock.calls.at(-1)?.[0] as string);
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

  it("pans the background without committing a change", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const stage = stageOf(container);
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(stage, { clientX: 60, clientY: 40 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("right-clicking a card opens its menu; Delete removes it", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.contextMenu(nodesOf(container)[0]);
    expect(screen.getByRole("menuitem", { name: "Edit text" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(lastData(onChange).nodes).toHaveLength(0);
  });

  it("right-clicking a card recolours it through the Colour submenu", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.contextMenu(nodesOf(container)[0]);
    fireEvent.click(screen.getByText("Colour"));
    fireEvent.click(screen.getByText("Yellow"));
    expect(lastData(onChange).nodes[0]).toMatchObject({ color: "3" });
  });

  it("right-clicking empty board space creates a node at the cursor", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={empty} onChange={onChange} />);
    fireEvent.contextMenu(stageOf(container), { clientX: 100, clientY: 60 });
    fireEvent.click(screen.getByText("New card"));
    // 250x120 card centred on the click point (untransformed viewport).
    expect(lastData(onChange).nodes[0]).toMatchObject({ type: "text", x: -25, y: 0 });
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

  it("right-clicking a card and choosing Edit text opens the inline editor", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.contextMenu(nodesOf(container)[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit text" }));
    expect(container.querySelector(".glyph-canvas-node-editor")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("right-clicking an edge and choosing Edit label opens the label editor", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.contextMenu(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit label" }));
    const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "labelled" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastData(onChange).edges[0]).toMatchObject({ label: "labelled" });
  });

  it("deleting the edge while its label editor is open closes the editor", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.doubleClick(container.querySelector(".glyph-canvas-edge-hit") as Element);
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeTruthy();
    // The edge vanishes out from under the editor; the editing id briefly
    // points at a no-longer-existing edge, which must render as "no editor".
    fireEvent.contextMenu(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete connection" }));
    expect(lastData(onChange).edges).toHaveLength(0);
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeNull();
  });

  it("right-clicking an edge offers Delete connection", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.contextMenu(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByText("Delete connection"));
    expect(lastData(onChange).edges).toHaveLength(0);
  });

  it("dragging a group carries the cards inside it, leaving outside cards alone", () => {
    const onChange = vi.fn();
    const content = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 0, y: 0, width: 400, height: 300, label: "Area" },
        { id: "in", type: "text", x: 50, y: 50, width: 200, height: 80, text: "inside" },
        { id: "out", type: "text", x: 600, y: 0, width: 200, height: 80, text: "outside" },
      ],
      edges: [],
    });
    const { container } = render(<CanvasEditor content={content} onChange={onChange} />);
    const group = container.querySelector('.glyph-canvas-node[data-type="group"]') as Element;
    fireEvent.pointerDown(group, { clientX: 10, clientY: 290, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 30, clientY: 300 });
    fireEvent.pointerUp(stageOf(container), { clientX: 30, clientY: 300 });
    const nodes = lastData(onChange).nodes;
    expect(nodes.find((n) => n.id === "g")).toMatchObject({ x: 20, y: 10 });
    expect(nodes.find((n) => n.id === "in")).toMatchObject({ x: 70, y: 60 });
    expect(nodes.find((n) => n.id === "out")).toMatchObject({ x: 600, y: 0 });
  });

  it("adds a group via the toolbar and commits it", () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={empty} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Add group"));
    const data = lastData(onChange);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].type).toBe("group");
  });

  it("adds a link via the toolbar and edits its URL inline", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={empty} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Add link"));
    expect(lastData(onChange).nodes[0].type).toBe("link");
    // The new link opens in inline edit; type the URL and commit with Enter.
    const ta = container.querySelector(".glyph-canvas-node-editor") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "https://glyph.dev" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(lastData(onChange).nodes[0]).toMatchObject({ type: "link", url: "https://glyph.dev" });
  });

  it("double-clicking a card opens its editor without creating a new card", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.doubleClick(nodesOf(container)[0]);
    expect(container.querySelector(".glyph-canvas-node-editor")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(nodesOf(container)).toHaveLength(1);
  });

  it("defers pointer capture until the gesture actually moves", () => {
    // Regression: capturing on pointerdown retargets the browser's dblclick to
    // the stage, so double-clicking a card created a new card instead of
    // opening the inline editor.
    const { container } = render(<CanvasEditor content={oneText} onChange={vi.fn()} />);
    const stage = stageOf(container) as HTMLElement & { setPointerCapture: () => void };
    const spy = vi.fn();
    stage.setPointerCapture = spy;
    fireEvent.pointerDown(nodesOf(container)[0], { clientX: 0, clientY: 0, button: 0 });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.pointerMove(stage, { clientX: 10, clientY: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
    // Further moves don't recapture.
    fireEvent.pointerMove(stage, { clientX: 20, clientY: 20 });
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(stage, { clientX: 20, clientY: 20 });
  });

  it("creates a card centred on the cursor on stage double-click", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={empty} onChange={onChange} />);
    fireEvent.doubleClick(stageOf(container), { clientX: 100, clientY: 60 });
    const data = lastData(onChange);
    expect(data.nodes).toHaveLength(1);
    // Viewport starts untransformed, so world == stage coords: the 250x120
    // card is centred on (100, 60).
    expect(data.nodes[0]).toMatchObject({ type: "text", x: -25, y: 0 });
  });

  it("re-selecting the only selected node keeps the same selection", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    // Select once, then click the same node again with no drag.
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    // Still selected: its resize handle remains visible.
    expect(container.querySelector(".glyph-canvas-resize")).toBeTruthy();
  });

  it("shift-clicking an already-selected node deselects it", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a, b] = nodesOf(container);
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.pointerDown(b, { clientX: 300, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerUp(stageOf(container), { clientX: 300, clientY: 0 });
    // Shift-click B again to remove it from the selection.
    fireEvent.pointerDown(b, { clientX: 300, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerUp(stageOf(container), { clientX: 300, clientY: 0 });
    // Only A remains selected: the toolbar count reads 1, so no "(n)" suffix.
    expect(screen.getByText("Delete")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(lastData(onChange).nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("dragging an already-selected node moves the existing selection", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={twoNodes} onChange={onChange} />);
    const [a, b] = nodesOf(container);
    // Select both nodes.
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    fireEvent.pointerDown(b, { clientX: 300, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerUp(stageOf(container), { clientX: 300, clientY: 0 });
    // Drag node A: both selected nodes shift together.
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 10, clientY: 20 });
    fireEvent.pointerUp(stageOf(container), { clientX: 10, clientY: 20 });
    const data = lastData(onChange);
    expect(data.nodes.find((n) => n.id === "a")).toMatchObject({ x: 10, y: 20 });
    expect(data.nodes.find((n) => n.id === "b")).toMatchObject({ x: 310, y: 20 });
  });

  it("ignores a non-primary button pointerDown on the stage", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const stage = stageOf(container);
    // Middle button: should neither pan nor clear selection nor commit.
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, button: 1 });
    fireEvent.pointerMove(stage, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(stage, { clientX: 80, clientY: 80 });
    const world = container.querySelector(".glyph-canvas-world") as HTMLElement;
    expect(world.style.transform).toContain("translate(0px, 0px)");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a stage pointerMove with no active gesture", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const world = container.querySelector(".glyph-canvas-world") as HTMLElement;
    // No pointerDown first: the move is a no-op (no pan, no commit).
    fireEvent.pointerMove(stageOf(container), { clientX: 50, clientY: 50 });
    expect(world.style.transform).toContain("translate(0px, 0px)");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a stage pointerUp with no active gesture", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps a resize below the minimum size to MIN_SIZE", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={oneText} onChange={onChange} />);
    const node = nodesOf(container)[0];
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(stageOf(container), { clientX: 0, clientY: 0 });
    const handle = container.querySelector(".glyph-canvas-resize") as Element;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    // Drag far in the negative direction so width/height clamp to MIN_SIZE (60).
    fireEvent.pointerMove(stageOf(container), { clientX: -500, clientY: -500 });
    fireEvent.pointerUp(stageOf(container), { clientX: -500, clientY: -500 });
    expect(lastData(onChange).nodes[0]).toMatchObject({ width: 60, height: 60 });
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

  it("toggles a task-list checkbox inside a card and commits the new text", () => {
    const tasks = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "- [ ] buy milk" },
      ],
      edges: [],
    });
    const onChange = vi.fn();
    render(<CanvasEditor content={tasks} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    const data = lastData(onChange);
    expect(data.nodes[0]).toMatchObject({ id: "a", text: "- [x] buy milk" });
  });

  it("generates an id when crypto.randomUUID is unavailable", () => {
    const onChange = vi.fn();
    const original = globalThis.crypto.randomUUID;
    // biome-ignore lint/suspicious/noExplicitAny: temporarily clear the API to hit the fallback
    (globalThis.crypto as any).randomUUID = undefined;
    try {
      render(<CanvasEditor content={empty} onChange={onChange} />);
      fireEvent.click(screen.getByLabelText("Add card"));
      const data = lastData(onChange);
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].id).toBeTruthy();
    } finally {
      globalThis.crypto.randomUUID = original;
    }
  });
});
