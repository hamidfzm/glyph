import { invoke } from "@tauri-apps/api/core";
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
});

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

  it("does nothing on mobile (no native menu there)", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("android");
    renderHook(() => useNativeMenuState(baseFlags));
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(platform).mockReturnValue("macos");
  });
});
