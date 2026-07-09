import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowReveal } from "./useWindowReveal";

// Mock the Tauri window API. `show`/`setFocus` are created via vi.hoisted so the
// hoisted vi.mock factory can reference them and tests can assert on the calls.
const { show, setFocus } = vi.hoisted(() => ({
  show: vi.fn(() => Promise.resolve()),
  setFocus: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show, setFocus }),
}));

// Mock useSettings so each test controls the `loaded` flag.
const { useSettingsMock } = vi.hoisted(() => ({ useSettingsMock: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: useSettingsMock }));

// Mock the CLI-export probe: null means a normal interactive launch.
const { getCliExportRequestMock } = vi.hoisted(() => ({ getCliExportRequestMock: vi.fn() }));
vi.mock("@/lib/cliExport", () => ({ getCliExportRequest: getCliExportRequestMock }));

function setLoaded(loaded: boolean) {
  useSettingsMock.mockReturnValue({ loaded });
}

describe("useWindowReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    show.mockClear();
    setFocus.mockClear();
    setLoaded(false);
    getCliExportRequestMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not reveal the window while settings are still loading", async () => {
    setLoaded(false);
    renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(2000);

    expect(show).not.toHaveBeenCalled();
  });

  it("shows and focuses the window after a painted frame once loaded", async () => {
    setLoaded(true);
    renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(50);

    expect(show).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenCalledTimes(1);
  });

  it("reveals when settings finish loading after mount", async () => {
    setLoaded(false);
    const { rerender } = renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(50);
    expect(show).not.toHaveBeenCalled();

    setLoaded(true);
    rerender();
    await vi.advanceTimersByTimeAsync(50);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("falls back to the timeout when requestAnimationFrame never fires", async () => {
    // Stub rAF to never invoke its callback so only the setTimeout path can run.
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setLoaded(true);
    renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(1000);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("reveals the window at most once even though rAF and the timeout both fire", async () => {
    setLoaded(true);
    renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(50); // rAF path
    await vi.advanceTimersByTimeAsync(2000); // timeout path

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("keeps the window hidden for a headless CLI export", async () => {
    getCliExportRequestMock.mockResolvedValue({ root: "/ws", outDir: "/out" });
    setLoaded(true);
    renderHook(() => useWindowReveal());

    await vi.advanceTimersByTimeAsync(2000);

    expect(show).not.toHaveBeenCalled();
  });

  it("does not reveal after unmount", async () => {
    setLoaded(true);
    const { unmount } = renderHook(() => useWindowReveal());

    unmount();
    await vi.advanceTimersByTimeAsync(2000);

    expect(show).not.toHaveBeenCalled();
  });
});
