import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type PanelResizeOptions, usePanelResize } from "./usePanelResize";

function Harness({ options }: { options: PanelResizeOptions }) {
  const { size, handleProps } = usePanelResize(options);
  return <div data-testid="handle" data-size={String(size)} {...handleProps} />;
}

function setup(overrides: Partial<PanelResizeOptions> = {}) {
  const onCommit = vi.fn();
  const onReset = vi.fn();
  const options: PanelResizeOptions = {
    size: 224,
    min: 160,
    max: 480,
    direction: 1,
    axis: "x",
    onCommit,
    onReset,
    ...overrides,
  };
  render(<Harness options={options} />);
  return { handle: screen.getByTestId("handle"), onCommit, onReset };
}

describe("usePanelResize", () => {
  it("tracks the drag live and commits once on release", () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { clientX: 130 });
    expect(handle.dataset.size).toBe("254");
    fireEvent.pointerMove(handle, { clientX: 150 });
    expect(handle.dataset.size).toBe("274");
    fireEvent.pointerUp(handle);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(274);
    // Idle again: back to the persisted size.
    expect(handle.dataset.size).toBe("224");
  });

  it("clamps to min and max while dragging", () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 0 });
    fireEvent.pointerMove(handle, { clientX: 1000 });
    expect(handle.dataset.size).toBe("480");
    fireEvent.pointerMove(handle, { clientX: -1000 });
    expect(handle.dataset.size).toBe("160");
    fireEvent.pointerUp(handle);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(160);
  });

  it("inverts the delta for direction -1", () => {
    const { handle } = setup({ direction: -1 });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { clientX: 50 });
    expect(handle.dataset.size).toBe("274");
  });

  it("uses clientY when axis is y", () => {
    const { handle } = setup({ axis: "y" });
    fireEvent.pointerDown(handle, { button: 0, clientY: 10 });
    fireEvent.pointerMove(handle, { clientY: 40 });
    expect(handle.dataset.size).toBe("254");
  });

  it("resolves getter size, max, and direction at drag start", () => {
    const { handle, onCommit } = setup({
      size: () => 300,
      max: () => 350,
      direction: () => 1,
    });
    // A getter idle size renders as null (DOM-measured panels size themselves).
    expect(handle.dataset.size).toBe("null");
    fireEvent.pointerDown(handle, { button: 0, clientX: 0 });
    fireEvent.pointerMove(handle, { clientX: 100 });
    expect(handle.dataset.size).toBe("350");
    fireEvent.pointerUp(handle);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(350);
  });

  it("ignores non-left buttons and moves without a drag", () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 2, clientX: 100 });
    fireEvent.pointerMove(handle, { clientX: 200 });
    expect(handle.dataset.size).toBe("224");
    fireEvent.pointerUp(handle);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit a drag that never moved", () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerUp(handle);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("suppresses text selection during the drag and restores it after", () => {
    const { handle } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerUp(handle);
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });

  it("calls onReset on double-click", () => {
    const { handle, onReset, onCommit } = setup();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("nudges the size with arrow keys, committing each step", () => {
    const { handle, onCommit } = setup();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith(240);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenCalledWith(208);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("clamps keyboard nudges at the bounds", () => {
    const { handle, onCommit } = setup({ size: 476 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(480);
  });

  it("uses vertical arrows for axis y and resolves getters per press", () => {
    const { handle, onCommit } = setup({
      axis: "y",
      size: () => 100,
      min: 80,
      max: () => 130,
      direction: () => -1,
    });
    // ArrowUp is physically -1; direction -1 turns it into growth.
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(116);
  });

  it("ignores non-arrow keys and arrows for the other axis", () => {
    const { handle, onCommit } = setup();
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
