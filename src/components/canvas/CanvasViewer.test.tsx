import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasViewer } from "./CanvasViewer";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const canvas = (over: object) => JSON.stringify({ nodes: [], edges: [], ...over });
const stageOf = (c: HTMLElement) => c.querySelector(".glyph-canvas-stage") as Element;

describe("CanvasViewer", () => {
  it("renders a text node's markdown", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "# Hello" }],
    });
    render(<CanvasViewer content={content} />);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("renders a link node showing its url", () => {
    const content = canvas({
      nodes: [
        { id: "l", type: "link", x: 0, y: 0, width: 200, height: 80, url: "https://glyph.dev" },
      ],
    });
    render(<CanvasViewer content={content} />);
    expect(screen.getByText("https://glyph.dev")).toBeInTheDocument();
  });

  it("shows an error state for invalid canvas JSON", () => {
    render(<CanvasViewer content="{ not json" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders zoom controls and responds to clicks", () => {
    const { container } = render(<CanvasViewer content={canvas({})} />);
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Fit to content")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Fit to content"));
    expect(container.querySelector(".glyph-canvas-stage")).toBeTruthy();
  });

  it("renders a group node and an image file node", () => {
    const content = canvas({
      nodes: [
        {
          id: "g",
          type: "group",
          x: -10,
          y: -10,
          width: 400,
          height: 300,
          label: "Area",
          color: "2",
        },
        { id: "f", type: "file", x: 0, y: 0, width: 120, height: 120, file: "pic.png" },
      ],
    });
    const { container } = render(<CanvasViewer content={content} filePath="/ws/board.canvas" />);
    expect(screen.getByText("Area")).toBeInTheDocument();
    expect(container.querySelector(".glyph-canvas-group")).toBeTruthy();
    expect(container.querySelector("img.glyph-canvas-node-image")).toBeTruthy();
  });

  it("opens a non-image file node via onOpenFile", () => {
    const onOpenFile = vi.fn();
    const content = canvas({
      nodes: [{ id: "f", type: "file", x: 0, y: 0, width: 200, height: 80, file: "notes/todo.md" }],
    });
    render(<CanvasViewer content={content} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("todo.md"));
    expect(onOpenFile).toHaveBeenCalledWith("notes/todo.md");
  });

  it("pans the board on background drag", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "x" }],
    });
    const { container } = render(<CanvasViewer content={content} />);
    const stage = stageOf(container);
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 50 });
    fireEvent.pointerUp(stage, { clientX: 60, clientY: 50 });
    const world = container.querySelector(".glyph-canvas-world") as HTMLElement;
    expect(world.style.transform).toContain("translate(50px, 40px)");
  });

  it("does not pan when the drag starts on a node", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "x" }],
    });
    const { container } = render(<CanvasViewer content={content} />);
    const node = container.querySelector(".glyph-canvas-node") as Element;
    fireEvent.pointerDown(node, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(stageOf(container), { clientX: 60, clientY: 50 });
    const world = container.querySelector(".glyph-canvas-world") as HTMLElement;
    expect(world.style.transform).toContain("translate(0px, 0px)");
  });

  it("ignores non-primary mouse buttons for panning", () => {
    const { container } = render(<CanvasViewer content={canvas({})} />);
    const stage = stageOf(container);
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, button: 2 });
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 50 });
    const world = container.querySelector(".glyph-canvas-world") as HTMLElement;
    expect(world.style.transform).toContain("translate(0px, 0px)");
  });

  it("toggles a task-list checkbox and reports the updated board", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "- [x] ship it" }],
    });
    const onChange = vi.fn();
    render(<CanvasViewer content={content} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("- [ ] ship it");
  });

  it("renders task checkboxes inert when no onChange is provided", () => {
    const content = canvas({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "- [ ] read" }],
    });
    render(<CanvasViewer content={content} />);
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    expect(screen.getByText("read")).toBeInTheDocument();
  });
});
