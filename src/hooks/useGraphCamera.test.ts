import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA, MAX_SCALE } from "@/lib/graphCanvas";
import { useGraphCamera } from "./useGraphCamera";

const VIEWPORT = { width: 800, height: 600 };

describe("useGraphCamera", () => {
  it("starts at the default camera", () => {
    const { result } = renderHook(() => useGraphCamera());
    expect(result.current.camera).toEqual(DEFAULT_CAMERA);
  });

  it("pans cumulatively", () => {
    const { result } = renderHook(() => useGraphCamera());
    act(() => result.current.pan(10, 20));
    act(() => result.current.pan(-4, 6));
    expect(result.current.camera).toEqual({ dx: 6, dy: 26, scale: 1 });
  });

  it("zooms at a point, clamped to bounds", () => {
    const { result } = renderHook(() => useGraphCamera());
    act(() => result.current.zoomAt(400, 300, 2, VIEWPORT));
    expect(result.current.camera.scale).toBe(2);
    act(() => result.current.zoomAt(400, 300, 1e9, VIEWPORT));
    expect(result.current.camera.scale).toBe(MAX_SCALE);
  });

  it("replaces the camera outright via set", () => {
    const { result } = renderHook(() => useGraphCamera());
    act(() => {
      result.current.pan(50, 50);
      result.current.zoomAt(0, 0, 3, VIEWPORT);
    });
    act(() => result.current.set({ dx: -10, dy: 7, scale: 1.5 }));
    expect(result.current.camera).toEqual({ dx: -10, dy: 7, scale: 1.5 });
  });

  it("keeps callback identities stable across camera changes", () => {
    const { result } = renderHook(() => useGraphCamera());
    const first = result.current;
    act(() => result.current.pan(1, 1));
    expect(result.current.pan).toBe(first.pan);
    expect(result.current.zoomAt).toBe(first.zoomAt);
    expect(result.current.set).toBe(first.set);
  });
});
