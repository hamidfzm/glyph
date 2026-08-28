import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { blockDropHandlers, TREE_DRAG_TYPE, useFileTreeDragMove } from "./useFileTreeDragMove";

interface MockDragEvent {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  currentTarget: { contains: (node: unknown) => boolean };
  relatedTarget: unknown;
  dataTransfer: {
    setData: ReturnType<typeof vi.fn>;
    effectAllowed: string;
    dropEffect: string;
    types: string[];
  };
}

const dragEvent = (overrides: Partial<MockDragEvent> = {}) =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: { contains: () => false },
    relatedTarget: null,
    dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "", types: [TREE_DRAG_TYPE] },
    ...overrides,
  }) as MockDragEvent & DragEvent;

/** A drag that did not start in the tree: no tree payload type. */
const foreignEvent = () =>
  dragEvent({
    dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "", types: ["text/plain"] },
  });

function renderDnd(onMoveEntry = vi.fn()) {
  const { result, unmount } = renderHook(() => useFileTreeDragMove("/root", onMoveEntry));
  const start = (path: string) => {
    act(() => {
      result.current.dragHandlersFor(path).onDragStart(dragEvent());
    });
  };
  const over = (dir: string, event = dragEvent()) => {
    act(() => {
      result.current.dropHandlersFor(dir).onDragOver(event);
    });
    return event;
  };
  const drop = (dir: string, event = dragEvent()) => {
    act(() => {
      result.current.dropHandlersFor(dir).onDrop(event);
    });
  };
  return { result, unmount, onMoveEntry, start, over, drop };
}

describe("useFileTreeDragMove", () => {
  it("marks rows draggable and sets the tree and plain-text payloads", () => {
    const { result } = renderDnd();
    const handlers = result.current.dragHandlersFor("/root/a.md");
    expect(handlers.draggable).toBe(true);
    const event = dragEvent();
    act(() => {
      handlers.onDragStart(event);
    });
    expect(event.dataTransfer.effectAllowed).toBe("move");
    expect(event.dataTransfer.setData).toHaveBeenCalledWith(TREE_DRAG_TYPE, "/root/a.md");
    // WebKit refuses to start a drag with an empty text payload.
    expect(event.dataTransfer.setData).toHaveBeenCalledWith("text/plain", "/root/a.md");
  });

  it("accepts a valid folder target: preventDefault, move cursor, highlight", () => {
    const { result, start, over } = renderDnd();
    start("/root/a.md");
    const event = over("/root/sub");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("move");
    expect(result.current.dropTarget).toBe("/root/sub");
    // dragover fires on every pointer move; the target stays stable.
    over("/root/sub");
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

  it("ignores foreign drags even when a stale tree drag is pending", () => {
    const { result, onMoveEntry, start, over, drop } = renderDnd();
    // A stale ref survives when dragend never fired (source row unmounted);
    // a later link/image drag from the document must not consume it.
    start("/root/a.md");
    const event = over("/root/sub", foreignEvent());
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.dropTarget).toBeNull();
    drop("/root/sub", foreignEvent());
    expect(onMoveEntry).not.toHaveBeenCalled();
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

  it("resets via the window fallback when dragend never reaches the row", () => {
    const { result, onMoveEntry, start, over, drop } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    // Chromium skips the row's dragend when the source unmounts mid-drag.
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(result.current.dropTarget).toBeNull();
    drop("/root/sub");
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("keeps the highlight when dragleave only crosses into the row's children", () => {
    const { result, start, over } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    act(() => {
      result.current
        .dropHandlersFor("/root/sub")
        .onDragLeave(dragEvent({ currentTarget: { contains: () => true } }));
    });
    expect(result.current.dropTarget).toBe("/root/sub");
  });

  it("clears the highlight on dragleave only for the hovered target", () => {
    const { result, start, over } = renderDnd();
    start("/root/a.md");
    over("/root/sub");
    act(() => {
      result.current.dropHandlersFor("/root/other").onDragLeave(dragEvent());
    });
    expect(result.current.dropTarget).toBe("/root/sub");
    act(() => {
      result.current.dropHandlersFor("/root/sub").onDragLeave(dragEvent());
    });
    expect(result.current.dropTarget).toBeNull();
  });

  it("blockDropHandlers swallows dragover without marking a target", () => {
    const event = dragEvent();
    blockDropHandlers.onDragOver(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("drops its window fallbacks on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { start, unmount } = renderDnd();
    start("/root/a.md");
    unmount();
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("dragend");
    expect(removed).toContain("drop");
    removeSpy.mockRestore();
  });
});
