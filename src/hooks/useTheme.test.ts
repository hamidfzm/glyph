import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.documentElement.classList.remove("dark");

    matchMediaMock = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;
  });

  it("returns light theme when system prefers light", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe("light");
  });

  it("returns dark theme when system prefers dark", () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe("dark");
  });

  it("skips event listener when override is provided", () => {
    const addListener = vi.fn();
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: addListener,
      removeEventListener: vi.fn(),
    });

    renderHook(() => useTheme("light"));
    expect(addListener).not.toHaveBeenCalled();
  });

  it("does not toggle dark class when override is provided", () => {
    renderHook(() => useTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles dark class when no override", () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("cleans up event listener on unmount", () => {
    const removeListener = vi.fn();
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: removeListener,
    });

    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(removeListener).toHaveBeenCalled();
  });
});
