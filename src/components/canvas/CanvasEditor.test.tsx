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
    const data = parseCanvas(onChange.mock.calls[0][0]);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].type).toBe("text");
  });

  it("exposes zoom and add-card controls", () => {
    render(<CanvasEditor content={empty} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Add card")).toBeInTheDocument();
    expect(screen.getByLabelText("Fit to content")).toBeInTheDocument();
  });
});
