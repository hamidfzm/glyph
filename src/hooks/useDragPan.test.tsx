import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useDragPan } from "./useDragPan";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useDragPan(ref);
  return <div ref={ref} data-testid="stage" />;
}

function setSize(el: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: client, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scroll, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: client, configurable: true });
}

function fire(el: HTMLElement, type: string, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
  );
}

describe("useDragPan", () => {
  it("scrolls the element when dragging overflowing content", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    setSize(stage, 1000, 200);
    stage.scrollLeft = 0;
    stage.scrollTop = 0;

    fire(stage, "pointerdown", 100, 100);
    fire(stage, "pointermove", 60, 70); // dragged -40, -30
    expect(stage.scrollLeft).toBe(40);
    expect(stage.scrollTop).toBe(30);
    fire(stage, "pointerup", 60, 70);
  });

  it("does nothing when the content fits (nothing to pan)", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    setSize(stage, 200, 200);
    stage.scrollLeft = 0;

    fire(stage, "pointerdown", 100, 100);
    fire(stage, "pointermove", 50, 50);
    expect(stage.scrollLeft).toBe(0);
  });

  it("ignores presses below the drag threshold", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    setSize(stage, 1000, 200);
    stage.scrollLeft = 0;

    fire(stage, "pointerdown", 100, 100);
    fire(stage, "pointermove", 101, 101); // ~1.4px, under threshold
    expect(stage.scrollLeft).toBe(0);
  });

  it("ignores non-primary (e.g. right) button presses", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    setSize(stage, 1000, 200);
    stage.scrollLeft = 0;

    stage.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 2,
        pointerId: 1,
      }),
    );
    fire(stage, "pointermove", 60, 70);
    expect(stage.scrollLeft).toBe(0);
  });

  it("swallows the click that trails a real drag, but not a plain click", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    setSize(stage, 1000, 200);

    // A plain click (no drag) passes through untouched.
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    stage.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);

    // A real drag arms a one-shot swallow for the trailing click.
    fire(stage, "pointerdown", 100, 100);
    fire(stage, "pointermove", 60, 70);
    fire(stage, "pointerup", 60, 70);
    const dragged = new MouseEvent("click", { bubbles: true, cancelable: true });
    stage.dispatchEvent(dragged);
    expect(dragged.defaultPrevented).toBe(true);

    // The swallow is one-shot: the next click is allowed through again.
    const next = new MouseEvent("click", { bubbles: true, cancelable: true });
    stage.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
});
