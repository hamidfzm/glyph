import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTreeDragMove } from "./useFileTreeDragMove";

function setHit(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint;
}

function zoneEl(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

const folderZone = (dir: string) => zoneEl({ "data-tree-drop-dir": dir });

const downEvent = (overrides: Partial<ReactPointerEvent> = {}) =>
  ({
    button: 0,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    ...overrides,
  }) as ReactPointerEvent;

const clickEvent = () =>
  ({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ReactPointerEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };

function renderDnd(onMoveEntry = vi.fn()) {
  const { result, unmount } = renderHook(() => useFileTreeDragMove("/root", onMoveEntry));
  const press = (path: string, overrides: Partial<ReactPointerEvent> = {}) => {
    act(() => {
      result.current.dragHandlersFor(path).onPointerDown(downEvent(overrides));
    });
  };
  const moveTo = (x = 50, y = 50) => {
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
    });
  };
  const release = (x = 50, y = 50) => {
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));
    });
  };
  return { result, unmount, onMoveEntry, press, moveTo, release };
}

describe("useFileTreeDragMove", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("ignores movement below the drag threshold, so plain clicks survive", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo(2, 2);
    expect(result.current.dropTarget).toBeNull();
    release(2, 2);
    expect(onMoveEntry).not.toHaveBeenCalled();
    const click = clickEvent();
    act(() => {
      result.current.dragHandlersFor("/root/a.md").onClickCapture(click);
    });
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it("highlights a valid folder target and commits the move on release", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo();
    expect(result.current.dropTarget).toBe("/root/sub");
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("grabbing");
    const ghost = document.querySelector("[data-tree-drag-ghost]");
    expect(ghost?.textContent).toBe("a.md");
    expect((ghost as HTMLElement).style.pointerEvents).toBe("none");
    release();
    expect(onMoveEntry).toHaveBeenCalledTimes(1);
    expect(onMoveEntry).toHaveBeenCalledWith("/root/a.md", "/root/sub");
    expect(result.current.dropTarget).toBeNull();
    expect(document.body.style.userSelect).toBe("");
    expect(document.querySelector("[data-tree-drag-ghost]")).toBeNull();
  });

  it("suppresses exactly one click after a completed drag", () => {
    const { result, press, moveTo, release } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo();
    release();
    const suppressed = clickEvent();
    act(() => {
      result.current.dragHandlersFor("/root/a.md").onClickCapture(suppressed);
    });
    expect(suppressed.preventDefault).toHaveBeenCalled();
    expect(suppressed.stopPropagation).toHaveBeenCalled();
    const clean = clickEvent();
    act(() => {
      result.current.dragHandlersFor("/root/a.md").onClickCapture(clean);
    });
    expect(clean.preventDefault).not.toHaveBeenCalled();
  });

  it("rejects the dragged entry itself, its descendants, and its current parent", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    for (const dir of ["/root/sub", "/root/sub/nested", "/root"]) {
      setHit(folderZone(dir));
      press("/root/sub");
      moveTo();
      expect(result.current.dropTarget).toBeNull();
      expect(document.body.style.cursor).toBe("no-drop");
      release();
      expect(onMoveEntry).not.toHaveBeenCalled();
      expect(document.body.style.cursor).toBe("");
    }
  });

  it("resolves unmarked elements (document area, panels) to no target", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    setHit(zoneEl({}));
    press("/root/sub/deep.md");
    moveTo();
    expect(result.current.dropTarget).toBeNull();
    release();
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("counts the root zone only when the pointer is over the container itself", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    const container = zoneEl({ "data-filetree-root": "", "data-tree-drop-dir": "/root" });
    const gap = document.createElement("ul");
    container.appendChild(gap);

    setHit(gap);
    press("/root/sub/deep.md");
    moveTo();
    expect(result.current.dropTarget).toBeNull();

    setHit(container);
    moveTo(60, 60);
    expect(result.current.dropTarget).toBe("/root");
    release(60, 60);
    expect(onMoveEntry).toHaveBeenCalledWith("/root/sub/deep.md", "/root");
  });

  it("ignores presses from touch and from non-primary buttons", () => {
    const { result, press, moveTo } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md", { pointerType: "touch" });
    moveTo();
    expect(result.current.dropTarget).toBeNull();
    press("/root/a.md", { button: 2 });
    moveTo(60, 60);
    expect(result.current.dropTarget).toBeNull();
  });

  it("cancels on Escape without moving anything", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.dropTarget).toBeNull();
    expect(document.querySelector("[data-tree-drag-ghost]")).toBeNull();
    release();
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("ignores other keys mid-drag", () => {
    const { result, press, moveTo } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(result.current.dropTarget).toBe("/root/sub");
  });

  it("ignores stray pointer and key events while no drag is in progress", () => {
    const { result, onMoveEntry, moveTo, release } = renderDnd();
    setHit(folderZone("/root/sub"));
    moveTo();
    expect(result.current.dropTarget).toBeNull();
    release();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("handles a hit-test miss (pointer outside any zone)", () => {
    const { result, onMoveEntry, press, moveTo, release } = renderDnd();
    setHit(null);
    press("/root/a.md");
    moveTo();
    expect(result.current.dropTarget).toBeNull();
    release();
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("detaches its window listeners and drops the ghost on unmount mid-drag", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { press, moveTo, unmount } = renderDnd();
    setHit(folderZone("/root/sub"));
    press("/root/a.md");
    moveTo();
    expect(document.querySelector("[data-tree-drag-ghost]")).not.toBeNull();
    unmount();
    expect(document.querySelector("[data-tree-drag-ghost]")).toBeNull();
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("pointermove");
    expect(removed).toContain("pointerup");
    expect(removed).toContain("keydown");
    removeSpy.mockRestore();
  });
});
