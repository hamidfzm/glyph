import { fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CanvasEdgeLabelEditor } from "./CanvasEdgeLabelEditor";

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  it("commits the pending value when unmounted without blur", async () => {
    const { container, input, onCommit } = setup();
    fireEvent.change(input, { target: { value: "pending" } });
    render(<div />, { container });
    await flushMicrotasks();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("pending");
  });

  it("does not commit during a StrictMode mount cycle", async () => {
    // StrictMode mounts, cleans up, and remounts effects; an eager cleanup
    // commit would close the editor the moment it opened.
    const onCommit = vi.fn();
    const { container } = render(
      <StrictMode>
        <CanvasEdgeLabelEditor
          at={{ x: 0, y: 0 }}
          initial="old"
          onCommit={onCommit}
          onCancel={vi.fn()}
        />
      </StrictMode>,
    );
    await flushMicrotasks();
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector(".glyph-canvas-edge-label-editor")).toBeInTheDocument();
  });

  it("still commits on a real unmount under StrictMode", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <CanvasEdgeLabelEditor
          at={{ x: 0, y: 0 }}
          initial="old"
          onCommit={onCommit}
          onCancel={vi.fn()}
        />
      </StrictMode>,
    );
    await flushMicrotasks();
    unmount();
    await flushMicrotasks();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("old");
  });
});
