import { vi } from "vitest";

const VIEWPORT = 500;

// happy-dom lays nothing out, reporting every element as 0x0 at offset 0, so the
// geometry the scroll-sync code reads has to be declared by hand.

export function sizeScroller(el: HTMLElement, range: number) {
  Object.defineProperty(el, "clientHeight", { value: VIEWPORT, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: VIEWPORT + range, configurable: true });
}

export function stubOffsetTop(el: HTMLElement, top: number) {
  Object.defineProperty(el, "offsetTop", { value: top, configurable: true });
}

/** Replaces ResizeObserver with one whose callbacks the caller fires by hand. */
export function captureResizeObserver() {
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => {
    for (const callback of observers) callback();
  };
}
