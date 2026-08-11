import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { saveViewport } from "@/lib/canvas/viewportStore";
import {
  empty,
  lastData,
  nodesOf,
  oneText,
  stageOf,
  twoNodes,
  withEdge,
} from "@/test/fixtures/canvas";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("CanvasEditor board operations", () => {
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
    fireEvent.click(screen.getByLabelText("Color 3"));
    expect(lastData(onChange).nodes[0]).toMatchObject({ color: "3" });
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

  it("does not recolour when only an edge is selected", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.pointerDown(container.querySelector(".glyph-canvas-edge-hit") as Element);
    // Toolbar is shown for the selected edge; clicking a swatch is a no-op.
    fireEvent.click(screen.getByLabelText("Color 1"));
    expect(onChange).not.toHaveBeenCalled();
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

  it("restores the viewer's persisted viewport when switching to edit mode", () => {
    saveViewport("tab:restore-edit", { x: -150, y: 60, zoom: 0.5 });
    const { container } = render(
      <CanvasEditor content={oneText} onChange={vi.fn()} viewportKey="tab:restore-edit" />,
    );
    const world = container.querySelector<HTMLElement>(".glyph-canvas-world");
    expect(world?.style.transform).toBe("translate(-150px, 60px) scale(0.5)");
  });

  it("fits the board on first mount when no viewpoint was persisted", () => {
    // happy-dom reports zero-sized elements, and fitToContent treats a
    // zero-sized stage as "nothing to fit" — give the stage real dimensions.
    const dims = {
      clientWidth: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 800 },
    };
    const proto = HTMLElement.prototype;
    const originalW = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const originalH = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperties(proto, dims);
    try {
      const { container } = render(
        <CanvasEditor content={oneText} onChange={vi.fn()} viewportKey="tab:fresh-edit" />,
      );
      const world = container.querySelector<HTMLElement>(".glyph-canvas-world");
      expect(world?.style.transform).not.toBe("translate(0px, 0px) scale(1)");
    } finally {
      if (originalW) Object.defineProperty(proto, "clientWidth", originalW);
      if (originalH) Object.defineProperty(proto, "clientHeight", originalH);
    }
  });
});
