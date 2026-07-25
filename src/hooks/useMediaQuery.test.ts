import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TABLET_QUERY, useCanSplit, useMediaQuery } from "./useMediaQuery";

const originalMatchMedia = window.matchMedia;

// Minimal MediaQueryList stub that records its change listeners so a test can
// flip `matches` and fire them, the way a real resize/rotation would.
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, fn: () => void) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_: string, fn: () => void) => {
      listeners.delete(fn);
    }),
  };
  const matchMedia = vi.fn(() => mql);
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return {
    matchMedia,
    mql,
    fire(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("useMediaQuery", () => {
  it("reports whether the query currently matches", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("re-renders when the query starts matching", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => {
      media.fire(true);
    });
    expect(result.current).toBe(true);
  });

  it("drops its listener on unmount", () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("returns false when matchMedia is unavailable", () => {
    // jsdom without matchMedia, and the same path a non-browser render takes.
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });
});

describe("useCanSplit", () => {
  it("asks for the tablet query", () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useCanSplit());
    expect(media.matchMedia).toHaveBeenCalledWith(TABLET_QUERY);
    expect(result.current).toBe(true);
  });

  it("is false on a viewport too small to split", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useCanSplit());
    expect(result.current).toBe(false);
  });
});
