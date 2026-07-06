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

  it("persists panel sizes through the width and backlinks setters", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayout({
        filesVisibleSetting: true,
        outlineVisibleSetting: true,
        updateSettings,
      }),
    );
    act(() => {
      result.current.setFilesSidebarWidth(300);
      result.current.setOutlineSidebarWidth(280);
      result.current.setBacklinksHeight(150);
      result.current.setBacklinksHeight(null);
    });
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarWidth", 300);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarWidth", 280);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksHeight", 150);
    expect(updateSettings).toHaveBeenLastCalledWith("layout.backlinksHeight", null);
  });

  it("resetLayout writes every layout default, sizes included", () => {
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
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarWidth", 224);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarWidth", 224);
    expect(updateSettings).toHaveBeenCalledWith("layout.aiPanelWidth", 340);
    expect(updateSettings).toHaveBeenCalledWith("layout.backlinksHeight", null);
  });
});
