import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { ghostEl } from "@/test/pointerDrag";
import { usePointerDrag } from "./usePointerDrag";

// The element-level behavior is pinned through the consumers
// (TabBar.dnd.test.tsx, useFileTreeDragMove.test.ts); this covers what needs
// two instances mounted at once, which is the normal app state (file tree and
// tab strip both alive).

function mountInstance() {
  const onDrop = vi.fn();
  const onReset = vi.fn();
  const hook = renderHook(() =>
    usePointerDrag<string, string>({
      ghostLabel: (payload) => payload,
      onDragMove: () => "target",
      onDrop,
      onReset,
    }),
  );
  const press = (payload: string) => {
    act(() => {
      hook.result.current.pressHandlersFor(payload).onPointerDown({
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        target: { setPointerCapture: vi.fn() },
      } as unknown as ReactPointerEvent);
    });
  };
  return { ...hook, onDrop, onReset, press };
}

const moveTo = (x: number, y: number) => {
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 1 }),
    );
  });
};

const release = () => {
  act(() => {
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  });
};

describe("usePointerDrag with several instances mounted", () => {
  it("lets an idle instance unmount without disturbing the active drag", () => {
    const active = mountInstance();
    const idle = mountInstance();
    active.press("a");
    moveTo(40, 40);
    expect(ghostEl()?.textContent).toBe("a");
    idle.unmount();
    expect(ghostEl()).not.toBeNull();
    expect(idle.onReset).not.toHaveBeenCalled();
    release();
    expect(active.onDrop).toHaveBeenCalledWith("a", "target");
    expect(idle.onDrop).not.toHaveBeenCalled();
    active.unmount();
  });

  it("routes Escape to the dragging instance only", () => {
    const active = mountInstance();
    const idle = mountInstance();
    active.press("a");
    moveTo(40, 40);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(ghostEl()).toBeNull();
    expect(active.onReset).toHaveBeenCalledTimes(1);
    expect(idle.onReset).not.toHaveBeenCalled();
    release();
    expect(active.onDrop).not.toHaveBeenCalled();
    active.unmount();
    idle.unmount();
  });
});
