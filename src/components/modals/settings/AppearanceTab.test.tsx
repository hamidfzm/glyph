import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { AppearanceTab } from "./AppearanceTab";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<AppearanceTab />, { wrapper });
  return { updateSettings };
}

describe("AppearanceTab", () => {
  it("updates theme, typography, and code settings", () => {
    const { updateSettings } = setup();

    fireEvent.click(screen.getByText("Light"));
    expect(updateSettings).toHaveBeenCalledWith("appearance.theme", "light");

    const [fontFamily, codeTheme] = screen.getAllByRole("combobox");
    fireEvent.change(fontFamily, { target: { value: "serif" } });
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontFamily", "serif");

    fireEvent.change(screen.getByRole("slider"), { target: { value: "20" } });
    expect(updateSettings).toHaveBeenCalledWith("appearance.fontSize", 20);

    fireEvent.click(screen.getByText("Compact"));
    expect(updateSettings).toHaveBeenCalledWith("appearance.lineHeight", "compact");

    fireEvent.click(screen.getByText("Wide"));
    expect(updateSettings).toHaveBeenCalledWith("appearance.contentWidth", "wide");

    fireEvent.change(screen.getByPlaceholderText(/Default \(SF Mono/), {
      target: { value: "Fira Code" },
    });
    expect(updateSettings).toHaveBeenCalledWith("appearance.codeFont", "Fira Code");

    fireEvent.change(codeTheme, { target: { value: "nord" } });
    expect(updateSettings).toHaveBeenCalledWith("appearance.codeTheme", "nord");
  });

  it("edits the custom font name when the font family is custom", () => {
    const { updateSettings } = setup({
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, fontFamily: "custom" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Inter, Lora"), {
      target: { value: "Inter" },
    });
    expect(updateSettings).toHaveBeenCalledWith("appearance.customFont", "Inter");
  });
});
