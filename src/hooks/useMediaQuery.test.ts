import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { TABLET_QUERY, useCanSplit, useMediaQuery } from "./useMediaQuery";

afterEach(restoreMatchMedia);

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
