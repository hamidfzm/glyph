import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasSelectionToolbar } from "./CanvasSelectionToolbar";

describe("CanvasSelectionToolbar", () => {
  it("clears the colour when the clear swatch is clicked", () => {
    const onSetColor = vi.fn();
    const { container } = render(
      <CanvasSelectionToolbar count={1} onSetColor={onSetColor} onDelete={vi.fn()} />,
    );
    const clear = container.querySelector(".glyph-canvas-swatch[data-clear]") as HTMLElement;
    fireEvent.click(clear);
    expect(onSetColor).toHaveBeenCalledWith(undefined);
  });

  it("sets a preset colour when a preset swatch is clicked", () => {
    const onSetColor = vi.fn();
    render(<CanvasSelectionToolbar count={1} onSetColor={onSetColor} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Colour 3"));
    expect(onSetColor).toHaveBeenCalledWith("3");
  });

  it("commits a custom colour when the picker's change event fires", () => {
    const onSetColor = vi.fn();
    render(<CanvasSelectionToolbar count={1} onSetColor={onSetColor} onDelete={vi.fn()} />);
    const picker = screen.getByLabelText("Custom colour") as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#123456" } });
    expect(onSetColor).toHaveBeenCalledWith("#123456");
  });

  it("deletes the selection when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<CanvasSelectionToolbar count={1} onSetColor={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows the count suffix when more than one node is selected", () => {
    render(<CanvasSelectionToolbar count={2} onSetColor={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Delete (2)")).toBeInTheDocument();
  });
});
