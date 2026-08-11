import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreRaf, stubRaf } from "@/test/raf";
import { useDrawerGesture } from "./useDrawerGesture";

type Dismissals = Set<(onDone: () => void) => void>;

function Harness({
  enabled,
  dismissals,
  close,
}: {
  enabled: boolean;
  dismissals: Dismissals;
  close: () => void;
}) {
  const drawer = useDrawerGesture({ enabled, edge: "left", dismissals, close });
  return (
    <div data-testid="parent">
      <nav data-testid="drawer" ref={drawer.ref} {...drawer.handlers}>
        <button type="button" data-testid="row" onClick={rowClick}>
          row
        </button>
        <hr data-resize-handle data-testid="resize" />
      </nav>
    </div>
  );
}

const rowClick = vi.fn();

function setup(enabled = true) {
  const raf = stubRaf();
  const dismissals: Dismissals = new Set();
  const settled = vi.fn();
  // Mimics useSidebarLayout.closeCompactPanels: run the registered dismissals.
  const close = vi.fn(() => {
    for (const dismiss of [...dismissals]) dismiss(settled);
  });
  const view = render(<Harness enabled={enabled} dismissals={dismissals} close={close} />);
  const drawer = screen.getByTestId("drawer");
  Object.defineProperty(drawer, "offsetWidth", { value: 300, configurable: true });
  return { raf, dismissals, settled, close, drawer, view };
}

const presence = (el: HTMLElement) => el.style.getPropertyValue("--presence");

function drag(drawer: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(drawer, { button: 0, pointerId: 1, clientX: from, clientY: 100 });
  // First move only engages (crosses the threshold); the second one tracks.
  fireEvent.pointerMove(drawer, { pointerId: 1, buttons: 1, clientX: from - 20, clientY: 100 });
  fireEvent.pointerMove(drawer, { pointerId: 1, buttons: 1, clientX: to, clientY: 100 });
}

afterEach(() => {
  restoreRaf();
  rowClick.mockClear();
});

describe("useDrawerGesture", () => {
  it("springs in from the edge on mount and mirrors presence per edge on the parent", () => {
    const { raf, drawer } = setup();
    expect(presence(drawer)).toBe("0");
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
    expect(screen.getByTestId("parent").style.getPropertyValue("--presence-left")).toBe("1");
  });

  it("does nothing when disabled (desktop sidebar)", () => {
    const { raf, drawer, dismissals } = setup(false);
    act(() => raf.settle());
    expect(presence(drawer)).toBe("");
    expect(dismissals.size).toBe(0);
    fireEvent.pointerDown(drawer, { button: 0, pointerId: 1, clientX: 250, clientY: 100 });
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 250, clientY: 100 });
    expect(presence(drawer)).toBe("");
  });

  it("a tap leaves the drawer open and the row click through", () => {
    const { raf, drawer, close } = setup();
    act(() => raf.settle());
    fireEvent.pointerDown(drawer, { button: 0, pointerId: 1, clientX: 250, clientY: 100 });
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 250, clientY: 100 });
    fireEvent.click(screen.getByTestId("row"));
    expect(rowClick).toHaveBeenCalledOnce();
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
    expect(close).not.toHaveBeenCalled();
  });

  it("tracks a horizontal drag 1:1 and dismisses when released near the edge", () => {
    const { raf, drawer, close, settled } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 40);
    // Baselined at the engage point (230): 1 + (40 - 230) / 300.
    expect(Number(presence(drawer))).toBeCloseTo(0.367, 2);

    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 40, clientY: 100 });
    expect(close).toHaveBeenCalledOnce();
    act(() => raf.settle());
    expect(presence(drawer)).toBe("0");
    expect(settled).toHaveBeenCalledOnce();
  });

  it("swallows the trailing click after a real drag", () => {
    const { raf, drawer } = setup();
    act(() => raf.settle());
    drag(drawer, 250, 200);
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.click(screen.getByTestId("row"));
    expect(rowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("row"));
    expect(rowClick).toHaveBeenCalledOnce();
  });

  it("springs back open when released past the midpoint", () => {
    const { raf, drawer, close } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 200);
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(close).not.toHaveBeenCalled();
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
  });

  it("ignores secondary buttons, the resize handle, and never drags below closed", () => {
    const { raf, drawer } = setup();
    act(() => raf.settle());

    // Right-click starts no drag.
    fireEvent.pointerDown(drawer, { button: 2, pointerId: 3, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 3, clientX: 100, clientY: 100 });
    expect(presence(drawer)).toBe("1");

    // The resize handle's hr owns its own drag.
    fireEvent.pointerDown(screen.getByTestId("resize"), {
      button: 0,
      pointerId: 4,
      clientX: 250,
      clientY: 100,
    });
    fireEvent.pointerMove(drawer, { pointerId: 4, clientX: 100, clientY: 100 });
    expect(presence(drawer)).toBe("1");

    // Dragging far past closed clamps at 0 instead of going negative.
    drag(drawer, 250, -400);
    expect(presence(drawer)).toBe("0");
  });

  it("rubberbands instead of following past the open edge", () => {
    const { raf, drawer } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 400);
    const over = Number(presence(drawer));
    expect(over).toBeGreaterThan(1);
    expect(over).toBeLessThan(1.5);
  });

  it("cedes to a vertical scroll and puts the drawer back", () => {
    const { raf, drawer, close } = setup();
    act(() => raf.settle());

    fireEvent.pointerDown(drawer, { button: 0, pointerId: 1, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 1, buttons: 1, clientX: 252, clientY: 160 });
    fireEvent.pointerMove(drawer, { pointerId: 1, buttons: 1, clientX: 100, clientY: 300 });
    expect(presence(drawer)).toBe("1");
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 100, clientY: 300 });
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
    expect(close).not.toHaveBeenCalled();
  });

  it("a grab mid-close freezes the sheet where it is", () => {
    const { raf, drawer, close } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 40);
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 40, clientY: 100 });
    expect(close).toHaveBeenCalledOnce();
    act(() => {
      raf.frame();
      raf.frame();
    });
    const midway = Number(presence(drawer));
    expect(midway).toBeGreaterThan(0);

    fireEvent.pointerDown(drawer, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    act(() => raf.frame());
    expect(Number(presence(drawer))).toBe(midway);
    fireEvent.pointerUp(drawer, { pointerId: 2, clientX: 100, clientY: 100 });
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
  });

  it("a rescued drawer is not closed later by the stale dismissal", () => {
    const { raf, drawer, close, settled, dismissals, view } = setup();
    act(() => raf.settle());

    // Backdrop-style dismissal arms the completion, spring heads to 0.
    act(() => {
      for (const dismiss of [...dismissals]) dismiss(settled);
    });
    act(() => raf.frame());

    // Grab mid-close and drag it back open past the midpoint.
    fireEvent.pointerDown(drawer, { button: 0, pointerId: 5, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 5, buttons: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 5, buttons: 1, clientX: 280, clientY: 100 });
    fireEvent.pointerUp(drawer, { pointerId: 5, clientX: 280, clientY: 100 });
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");
    expect(settled).not.toHaveBeenCalled();

    // Leaving compact mode must not fire the disarmed completion either.
    view.rerender(<Harness enabled={false} dismissals={dismissals} close={close} />);
    expect(settled).not.toHaveBeenCalled();
  });

  it("cancels a mouse drag that was released outside before engaging", () => {
    const { raf, drawer, close } = setup();
    act(() => raf.settle());

    // Down, tiny move, release off-element (no pointerup reaches the nav),
    // then a buttonless hover move: the drag must not resume.
    fireEvent.pointerDown(drawer, { button: 0, pointerId: 6, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 6, buttons: 1, clientX: 247, clientY: 100 });
    fireEvent.pointerMove(drawer, { pointerId: 6, buttons: 0, clientX: 60, clientY: 100 });
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");

    fireEvent.pointerMove(drawer, { pointerId: 6, buttons: 0, clientX: 40, clientY: 100 });
    expect(presence(drawer)).toBe("1");
    fireEvent.click(screen.getByTestId("row"));
    expect(rowClick).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("pointer cancel restores the open position and does not eat the next tap", () => {
    const { raf, drawer } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 150);
    fireEvent.pointerCancel(drawer, { pointerId: 1 });
    act(() => raf.settle());
    expect(presence(drawer)).toBe("1");

    fireEvent.click(screen.getByTestId("row"));
    expect(rowClick).toHaveBeenCalledOnce();
  });

  it("still settles the layout state when unmounted mid-dismissal", () => {
    const { raf, drawer, settled, dismissals, close, view } = setup();
    act(() => raf.settle());

    drag(drawer, 250, 40);
    fireEvent.pointerUp(drawer, { pointerId: 1, clientX: 40, clientY: 100 });
    act(() => raf.frame());
    expect(settled).not.toHaveBeenCalled();

    view.rerender(<Harness enabled={false} dismissals={dismissals} close={close} />);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("cleans the parent's --presence up when the drawer leaves compact mode", () => {
    const { raf, dismissals, close, view } = setup();
    act(() => raf.settle());
    expect(screen.getByTestId("parent").style.getPropertyValue("--presence-left")).toBe("1");

    view.rerender(<Harness enabled={false} dismissals={dismissals} close={close} />);
    expect(screen.getByTestId("parent").style.getPropertyValue("--presence-left")).toBe("");
    expect(dismissals.size).toBe(0);
  });
});
