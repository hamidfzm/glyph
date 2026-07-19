import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { LanguageSetting } from "./LanguageSetting";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<LanguageSetting />, { wrapper });
  return { updateSettings };
}

describe("LanguageSetting", () => {
  it("defaults to the System option and lists bundled locales", () => {
    setup();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("system");
    expect(screen.getByRole("option", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "فارسی" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Español" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
  });

  it("persists the chosen locale", () => {
    const { updateSettings } = setup();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    expect(updateSettings).toHaveBeenCalledWith("appearance.locale", "en");
  });
});
