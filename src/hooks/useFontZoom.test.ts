import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/lib/settings";
import { useFontZoom } from "./useFontZoom";

describe("useFontZoom", () => {
  it("zoomIn writes fontSize + step, clamped to ZOOM_MAX", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() => useFontZoom({ fontSize: 16, updateSettings }));
    act(() => result.current.zoomIn());
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontSize", 16 + ZOOM_STEP);

    updateSettings.mockClear();
    const { result: maxed } = renderHook(() => useFontZoom({ fontSize: ZOOM_MAX, updateSettings }));
    act(() => maxed.current.zoomIn());
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontSize", ZOOM_MAX);
  });

  it("zoomOut writes fontSize - step, clamped to ZOOM_MIN", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() =>
      useFontZoom({ fontSize: ZOOM_MIN + ZOOM_STEP, updateSettings }),
    );
    act(() => result.current.zoomOut());
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontSize", ZOOM_MIN);
  });

  it("zoomReset writes ZOOM_DEFAULT", () => {
    const updateSettings = vi.fn();
    const { result } = renderHook(() => useFontZoom({ fontSize: 24, updateSettings }));
    act(() => result.current.zoomReset());
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontSize", ZOOM_DEFAULT);
  });
});
