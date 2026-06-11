import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveHeading } from "./useActiveHeading";
import type { TocEntry } from "./useTableOfContents";

function entry(id: string): TocEntry {
  return { id, text: id, level: 2 };
}

function addHeading(id: string) {
  const el = document.createElement("h2");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

type Intersection = { isIntersecting: boolean; target: { id: string } };

describe("useActiveHeading", () => {
  let observerCallback: ((intersections: Intersection[]) => void) | undefined;
  let observe: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    observe = vi.fn();
    disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
        constructor(cb: (intersections: Intersection[]) => void) {
          observerCallback = cb;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    observerCallback = undefined;
  });

  it("returns an empty id initially and observes each heading that exists", () => {
    const a = addHeading("a");
    const b = addHeading("b");

    const { result } = renderHook(() => useActiveHeading([entry("a"), entry("b"), entry("gone")]));

    expect(result.current).toBe("");
    expect(observe).toHaveBeenCalledWith(a);
    expect(observe).toHaveBeenCalledWith(b);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("does not create an observer when there are no entries", () => {
    renderHook(() => useActiveHeading([]));
    expect(observerCallback).toBeUndefined();
  });

  it("activates the first intersecting heading reported by the observer", () => {
    addHeading("a");
    addHeading("b");
    const { result } = renderHook(() => useActiveHeading([entry("a"), entry("b")]));

    act(() => {
      observerCallback?.([
        { isIntersecting: false, target: { id: "a" } },
        { isIntersecting: true, target: { id: "b" } },
      ]);
    });

    expect(result.current).toBe("b");
  });

  it("follows programmatic scrolls immediately and locks out the observer", () => {
    addHeading("a");
    addHeading("b");
    const { result } = renderHook(() => useActiveHeading([entry("a"), entry("b")]));

    act(() => {
      window.dispatchEvent(new CustomEvent("glyph:active-heading", { detail: { id: "b" } }));
    });
    expect(result.current).toBe("b");

    act(() => {
      observerCallback?.([{ isIntersecting: true, target: { id: "a" } }]);
    });
    expect(result.current).toBe("b");
  });

  it("disconnects the observer on unmount", () => {
    addHeading("a");
    const { unmount } = renderHook(() => useActiveHeading([entry("a")]));
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
