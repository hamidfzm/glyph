import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NativeMenuFlags, useNativeMenuState } from "./useNativeMenuState";

const baseFlags: NativeMenuFlags = {
  hasTab: false,
  hasFile: false,
  hasContent: false,
  hasWorkspace: false,
  aiConfigured: false,
  ttsAvailable: false,
  hasDirty: false,
  autoSave: true,
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockImplementation(() => Promise.resolve(vi.fn()));
  vi.mocked(platform).mockReturnValue("macos");
});

/** Deliver a window-focus event to the listener the hook registered. */
function focusWindow() {
  const registration = vi.mocked(listen).mock.calls.find(([event]) => event === "tauri://focus");
  if (!registration) throw new Error("no focus listener registered");
  registration[1]({ event: "tauri://focus", id: 0, payload: null });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Leave every invoke pending until its resolver (in call order) is run. */
function holdInvokes() {
  const release: Array<() => void> = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(() => new Promise<void>((resolve) => release.push(resolve)));
  return release;
}

describe("useNativeMenuState", () => {
  it("invokes set_menu_state with the flags on mount", () => {
    renderHook(() =>
      useNativeMenuState({
        ...baseFlags,
        hasTab: true,
        hasFile: true,
        hasContent: true,
        hasWorkspace: true,
        aiConfigured: true,
        ttsAvailable: true,
        hasDirty: true,
        autoSave: false,
      }),
    );
    expect(invoke).toHaveBeenCalledWith("set_menu_state", {
      flags: {
        hasTab: true,
        hasFile: true,
        hasContent: true,
        hasWorkspace: true,
        aiConfigured: true,
        ttsAvailable: true,
        hasDirty: true,
        autoSave: false,
      },
    });
  });

  it("re-invokes only when a flag actually changes", () => {
    const { rerender } = renderHook((props: NativeMenuFlags) => useNativeMenuState(props), {
      initialProps: baseFlags,
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    // Same values, new object reference — no re-invoke
    rerender({ ...baseFlags });
    expect(invoke).toHaveBeenCalledTimes(1);

    // Real change
    rerender({ ...baseFlags, hasTab: true });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("set_menu_state", {
      flags: { ...baseFlags, hasTab: true },
    });
  });

  it("swallows invoke errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    renderHook(() => useNativeMenuState(baseFlags));
    // microtask flush
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalled();
  });

  it("does nothing on mobile (no native menu there)", () => {
    vi.mocked(platform).mockReturnValue("android");
    renderHook(() => useNativeMenuState(baseFlags));
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it.each(["macos", "linux"] as const)(
    "re-sends the current flags when the window gains focus on %s",
    (os) => {
      // One app menu serves every window there, so it may hold another window's
      // state by the time this one is focused again.
      vi.mocked(platform).mockReturnValue(os);
      const { rerender } = renderHook((props: NativeMenuFlags) => useNativeMenuState(props), {
        initialProps: baseFlags,
      });
      rerender({ ...baseFlags, hasFile: true });
      vi.mocked(invoke).mockClear();

      focusWindow();

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("set_menu_state", {
        flags: { ...baseFlags, hasFile: true },
      });
    },
  );

  it("does not listen for focus on Windows, where each window owns its menu", () => {
    vi.mocked(platform).mockReturnValue("windows");
    renderHook(() => useNativeMenuState(baseFlags));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(listen).not.toHaveBeenCalled();
  });

  it("collapses a burst of focus events into one push in flight and one queued", async () => {
    renderHook(() => useNativeMenuState(baseFlags));
    await settle();
    const release = holdInvokes();

    for (let i = 0; i < 5; i++) focusWindow();
    expect(invoke).toHaveBeenCalledTimes(1);

    // The queued push goes out once the first lands, so the menu still ends
    // on this window's state after the last focus event.
    release[0]();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);

    release[1]();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);

    // Nothing is left queued, and a later focus pushes again.
    focusWindow();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("drops the queued push when the hook unmounts mid-flight", async () => {
    const { unmount } = renderHook(() => useNativeMenuState(baseFlags));
    await settle();
    const release = holdInvokes();
    focusWindow();
    focusWindow();

    unmount();
    release[0]();
    await settle();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps re-sending on focus after a push fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useNativeMenuState(baseFlags));
    await settle();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);

    focusWindow();
    await settle();
    focusWindow();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("stops listening for focus on unmount", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    const { unmount } = renderHook(() => useNativeMenuState(baseFlags));

    unmount();
    await settle();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
