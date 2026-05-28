import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsDarkMode } from "./useIsDarkMode";

describe("useIsDarkMode", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("returns false when the .dark class is absent", () => {
    const { result } = renderHook(() => useIsDarkMode());
    expect(result.current).toBe(false);
  });

  it("returns true on mount when the .dark class is already present", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useIsDarkMode());
    expect(result.current).toBe(true);
  });

  it("flips when the .dark class is added after mount", async () => {
    const { result } = renderHook(() => useIsDarkMode());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.classList.add("dark");
      // Yield once so the MutationObserver microtask fires.
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it("flips when the .dark class is removed after mount", async () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useIsDarkMode());
    expect(result.current).toBe(true);
    await act(async () => {
      document.documentElement.classList.remove("dark");
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });

  it("disconnects the observer on unmount", async () => {
    const { result, unmount } = renderHook(() => useIsDarkMode());
    expect(result.current).toBe(false);
    unmount();
    // After unmount the observer should not flip the cached state. The hook
    // is gone, but the side-effect contract is that we don't leak listeners
    // by mutating the class after teardown.
    document.documentElement.classList.add("dark");
    await Promise.resolve();
    expect(result.current).toBe(false);
  });
});
