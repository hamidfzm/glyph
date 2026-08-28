import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { blockDropHandlers, useFileTreeDragMove } from "./useFileTreeDragMove";

const dragEvent = () =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" },
  }) as unknown as DragEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
    dataTransfer: { setData: ReturnType<typeof vi.fn>; effectAllowed: string; dropEffect: string };
  };

function renderDnd(onMoveEntry = vi.fn()) {
  const { result } = renderHook(() => useFileTreeDragMove("/root", onMoveEntry));
  const start = (path: string) => {
    act(() => {
      result.current.dragHandlersFor(path).onDragStart(dragEvent());
    });
  };
  const over = (dir: string) => {
    const event = dragEvent();
    act(() => {
      result.current.dropHandlersFor(dir).onDragOver(event);
    });
    return event;
  };
  const drop = (dir: string) => {
    act(() => {
      result.current.dropHandlersFor(dir).onDrop(dragEvent());
    });
  };
  return { result, onMoveEntry, start, over, drop };
}

describe("useFileTreeDragMove", () => {
  it("marks rows draggable and sets a drag payload (WebKit needs one)", () => {
    const { result } = renderDnd();
    const handlers = result.current.dragHandlersFor("/root/a.md");
    expect(handlers.draggable).toBe(true);
    const event = dragEvent();
    act(() => {
      handlers.onDragStart(event);
    });
    expect(event.dataTransfer.effectAllowed).toBe("move");
    expect(event.dataTransfer.setData).toHaveBeenCalledWith("text/plain", "/root/a.md");
  });

  it("accepts a valid folder target: preventDefault, move cursor, highlight", () => {
    const { result, start, over } = renderDnd();
    start("/root/a.md");
    const event = over("/root/sub");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("move");
    expect(result.current.dropTarget).toBe("/root/sub");
  });

  it("rejects the dragged entry itself, its descendants, and its current parent", () => {
    const { result, start, over } = renderDnd();
    start("/root/sub");
    for (const dir of ["/root/sub", "/root/sub/nested", "/root"]) {
      const event = over(dir);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(result.current.dropTarget).toBeNull();
    }
  });

  it("rejects every target while no drag is in progress", () => {
    const { result, over } = renderDnd();
    const event = over("/root/sub");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.dropTarget).toBeNull();
  });

  it("commits a valid drop through onMoveEntry exactly once and resets", () => {
    const { result, onMoveEntry, start, over, drop } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    drop("/root/sub");
    expect(onMoveEntry).toHaveBeenCalledTimes(1);
    expect(onMoveEntry).toHaveBeenCalledWith("/root/a.md", "/root/sub");
    expect(result.current.dropTarget).toBeNull();
    // The drag is consumed: a second drop is inert.
    drop("/root/sub");
    expect(onMoveEntry).toHaveBeenCalledTimes(1);
  });

  it("re-validates on drop and refuses an invalid target", () => {
    const { onMoveEntry, start, drop } = renderDnd();
    start("/root/sub");
    drop("/root/sub/nested");
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("clears the drag and the highlight on dragend", () => {
    const { result, onMoveEntry, start, over, drop } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    act(() => {
      result.current.dragHandlersFor("/root/a.md").onDragEnd();
    });
    expect(result.current.dropTarget).toBeNull();
    drop("/root/sub");
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("clears the highlight on dragleave only for the hovered target", () => {
    const { result, start, over } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    act(() => {
      result.current.dropHandlersFor("/root/other").onDragLeave();
    });
    expect(result.current.dropTarget).toBe("/root/sub");
    act(() => {
      result.current.dropHandlersFor("/root/sub").onDragLeave();
    });
    expect(result.current.dropTarget).toBeNull();
  });

  it("blockDropHandlers swallows dragover without marking a target", () => {
    const event = dragEvent();
    blockDropHandlers.onDragOver(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
