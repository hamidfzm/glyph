import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarLayout } from "./useSidebarLayout";

describe("useSidebarLayout", () => {
  it("mirrors the initial settings into local state", () => {
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: false,
        outlineVisibleSetting: true,
        updateSettings: vi.fn(),
      }),
    );
    expect(result.current.filesVisible).toBe(false);
    expect(result.current.outlineVisible).toBe(true);
  });

  it("re-syncs when the persisted setting changes externally", () => {
    const { result, rerender } = renderHook(
      (props: { filesVisibleSetting: boolean; outlineVisibleSetting: boolean }) =>
        useSidebarLayout({ ...props, updateSettings: vi.fn() }),
      { initialProps: { filesVisibleSetting: true, outlineVisibleSetting: true } },
    );
    rerender({ filesVisibleSetting: false, outlineVisibleSetting: true });
    expect(result.current.filesVisible).toBe(false);
  });

  it("toggleFiles flips local state and persists the new value", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.toggleFiles();
    });
    expect(result.current.filesVisible).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarVisible", false);
  });

  it("toggleOutline flips local state and persists the new value", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.toggleOutline();
    });
    expect(result.current.outlineVisible).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarVisible", false);
  });

  it("resetLayout writes the four defaults", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: false,
        outlineVisibleSetting: false,
        updateSettings,
      }),
    );
    act(() => {
      result.current.resetLayout();
    });
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarVisible", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarVisible", true);
    expect(updateSettings).toHaveBeenCalledWith("layout.sidebarLayout", "beside");
    expect(updateSettings).toHaveBeenCalledWith("layout.swapSidebarSides", false);
  });
});
