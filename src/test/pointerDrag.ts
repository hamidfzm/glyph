import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// Helpers for the pointer drag suites (usePointerDrag consumers). jsdom does
// no hit-testing, so the element under the pointer is pinned per step.

export function setHit(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint;
}

/** Press `source`, cross the drag threshold, and hover `target`. */
export function dragFromTo(source: Element, target: Element | null) {
  fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
  setHit(target);
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
}

export const releaseAt = (x = 40, y = 40) =>
  fireEvent.pointerUp(window, { clientX: x, clientY: y });

export const ghostEl = () => document.querySelector(".drag-ghost") as HTMLElement | null;
