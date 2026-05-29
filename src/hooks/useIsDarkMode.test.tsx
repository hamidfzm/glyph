import { act, renderHook } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // SSR safety: in a non-DOM runtime `document` is undefined. The hook
  // must fall back to `false` instead of dereferencing
  // `document.documentElement` and crashing the render. We can't use
  // `renderHook` here because the helper itself reads `document.body` to
  // build its test container, so we mount the hook into a pre-created
  // root and stub `document` only across the render call itself.
  it("returns false and skips observer setup when document is undefined", () => {
    const container = document.createElement("div");
    let captured: boolean | null = null;
    function Probe() {
      captured = useIsDarkMode();
      return null;
    }
    const root = createRoot(container);
    vi.stubGlobal("document", undefined);
    try {
      act(() => root.render(<Probe />));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(captured).toBe(false);
    expect(() => act(() => root.unmount())).not.toThrow();
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
