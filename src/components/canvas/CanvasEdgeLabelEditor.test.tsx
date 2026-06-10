import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEdgeLabelEditor } from "./CanvasEdgeLabelEditor";

function setup(over: Partial<React.ComponentProps<typeof CanvasEdgeLabelEditor>> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onParentPointerDown = vi.fn();
  const { container } = render(
    <div onPointerDown={onParentPointerDown}>
      <CanvasEdgeLabelEditor
        at={{ x: 120, y: 80 }}
        initial="old"
        onCommit={onCommit}
        onCancel={onCancel}
        {...over}
      />
    </div>,
  );
  const input = container.querySelector(".glyph-canvas-edge-label-editor") as HTMLInputElement;
  return { container, input, onCommit, onCancel, onParentPointerDown };
}

describe("CanvasEdgeLabelEditor", () => {
  it("commits only once when blur follows an Enter commit", () => {
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: "done" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("done");
  });

  it("keeps pointer presses inside the input from reaching the stage", () => {
    const { input, onParentPointerDown } = setup();
    fireEvent.pointerDown(input);
    expect(onParentPointerDown).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing", () => {
    const { input, onCommit, onCancel } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
