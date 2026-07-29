import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { REDUCED_MOTION_QUERY } from "@/lib/reducedMotion";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { useReducedMotion } from "./useReducedMotion";

afterEach(restoreMatchMedia);

describe("useReducedMotion", () => {
  it("asks for the reduced-motion query", () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(media.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(result.current).toBe(true);
  });

  it("is false when the OS has no motion preference", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("re-renders when the preference is turned on after mount", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      media.fire(true);
    });
    expect(result.current).toBe(true);
  });
});
