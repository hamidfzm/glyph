import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsContext, type SettingsContextValue } from "../contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { useSettings } from "./useSettings";

describe("useSettings", () => {
  it("returns the default SettingsContext value when no provider is mounted", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.current.loaded).toBe(false);
    expect(typeof result.current.updateSettings).toBe("function");
    expect(typeof result.current.resetSettings).toBe("function");
  });

  it("returns the value supplied by a custom SettingsContext.Provider", () => {
    const value: SettingsContextValue = {
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: () => {},
      resetSettings: () => {},
      loaded: true,
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current).toBe(value);
    expect(result.current.loaded).toBe(true);
  });
});
