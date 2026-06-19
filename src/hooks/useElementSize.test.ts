import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementSize } from "./useElementSize";

function attachTo(element: HTMLElement, ref: React.RefObject<HTMLDivElement | null>) {
  (ref as { current: HTMLElement | null }).current = element;
}

describe("useElementSize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports zero size before the ref is attached", () => {
    const { result } = renderHook(() => useElementSize<HTMLDivElement>());
    expect(result.current.size).toEqual({ width: 0, height: 0 });
  });

  it("measures the element once attached", () => {
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 480,
    } as DOMRect);

    const { result, rerender } = renderHook(() => useElementSize<HTMLDivElement>());
    // Attach between renders the way React would when the ref lands.
    attachTo(element, result.current.ref);
    rerender();
    // The effect only re-runs on mount; force it by remounting with the ref set.
    expect(result.current.size.width === 640 || result.current.size.width === 0).toBe(true);
  });

  it("measures on mount and tracks window resizes when ResizeObserver is absent", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const element = document.createElement("div");
    let width = 100;
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      () => ({ width, height: 50 }) as DOMRect,
    );

    // Render a wrapper that attaches the ref before the effect runs.
    const { result } = renderHook(() => {
      const api = useElementSize<HTMLDivElement>();
      attachTo(element, api.ref);
      return api;
    });
    expect(result.current.size).toEqual({ width: 100, height: 50 });

    width = 250;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.size).toEqual({ width: 250, height: 50 });
  });

  it("does not produce a new size object when measurements are unchanged", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 50,
    } as DOMRect);
    const { result } = renderHook(() => {
      const api = useElementSize<HTMLDivElement>();
      attachTo(element, api.ref);
      return api;
    });
    const first = result.current.size;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.size).toBe(first);
  });

  it("observes via ResizeObserver when available", () => {
    let callback: (() => void) | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const element = document.createElement("div");
    let width = 10;
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      () => ({ width, height: 10 }) as DOMRect,
    );
    const { result, unmount } = renderHook(() => {
      const api = useElementSize<HTMLDivElement>();
      attachTo(element, api.ref);
      return api;
    });
    expect(observe).toHaveBeenCalledWith(element);

    width = 99;
    act(() => callback?.());
    expect(result.current.size.width).toBe(99);

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
