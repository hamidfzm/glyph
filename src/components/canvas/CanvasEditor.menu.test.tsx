import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { empty, lastData, nodesOf, oneText, stageOf, withEdge } from "@/test/fixtures/canvas";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("CanvasEditor context menu", () => {
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
    fireEvent.click(screen.getByText("Color"));
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

  it("right-clicking an edge offers Delete connection", () => {
    const onChange = vi.fn();
    const { container } = render(<CanvasEditor content={withEdge} onChange={onChange} />);
    fireEvent.contextMenu(container.querySelector(".glyph-canvas-edge-hit") as Element);
    fireEvent.click(screen.getByText("Delete connection"));
    expect(lastData(onChange).edges).toHaveLength(0);
  });
});
