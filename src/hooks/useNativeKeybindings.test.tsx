import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useNativeKeybindings } from "./useNativeKeybindings";

function ctx(over: Partial<SettingsContextValue> = {}): SettingsContextValue {
  return {
    settings: DEFAULT_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    loaded: true,
    ...over,
  };
}

function wrapperFor(value: SettingsContextValue) {
  return ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNativeKeybindings", () => {
  it("does nothing until settings have loaded", () => {
    renderHook(() => useNativeKeybindings(), { wrapper: wrapperFor(ctx({ loaded: false })) });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the resolved bindings to the native menu once loaded", async () => {
    renderHook(() => useNativeKeybindings(), { wrapper: wrapperFor(ctx()) });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "apply_keybindings",
        expect.objectContaining({ bindings: expect.objectContaining({ open: "CmdOrCtrl+O" }) }),
      ),
    );
  });

  it("logs when the native call rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("nope"));
    renderHook(() => useNativeKeybindings(), { wrapper: wrapperFor(ctx()) });
    await waitFor(() => expect(error).toHaveBeenCalled());
  });
});
