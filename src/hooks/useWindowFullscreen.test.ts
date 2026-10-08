import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowFullscreen } from "./useWindowFullscreen";

const { isFullscreen, invoke } = vi.hoisted(() => ({
  isFullscreen: vi.fn(() => Promise.resolve(false)),
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("useWindowFullscreen", () => {
  beforeEach(() => {
    isFullscreen.mockClear();
    invoke.mockClear();
  });

  it("goes window-fullscreen while mounted and restores on unmount", async () => {
    const { unmount } = renderHook(() => useWindowFullscreen());
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_overlay_fullscreen", { enter: true }),
    );
    unmount();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_overlay_fullscreen", { enter: false }),
    );
  });

  it("leaves an already-fullscreen window alone", async () => {
    isFullscreen.mockResolvedValueOnce(true);
    const { unmount } = renderHook(() => useWindowFullscreen());
    await waitFor(() => expect(isFullscreen).toHaveBeenCalled());
    unmount();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not enter when unmounted before the state check resolves", async () => {
    const { unmount } = renderHook(() => useWindowFullscreen());
    unmount();
    await waitFor(() => expect(isFullscreen).toHaveBeenCalled());
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
});
