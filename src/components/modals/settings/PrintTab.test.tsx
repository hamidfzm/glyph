import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { PrintTab } from "./PrintTab";

function setup() {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings: DEFAULT_SETTINGS,
    updateSettings,
    resetSettings: vi.fn(),
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<PrintTab />, { wrapper });
  return { updateSettings };
}

describe("PrintTab", () => {
  it("updates page-break level and the toggles", () => {
    const { updateSettings } = setup();

    fireEvent.click(screen.getByText("At H1"));
    expect(updateSettings).toHaveBeenCalledWith("print.pageBreakLevel", "h1");

    const [toc, background] = screen.getAllByRole("checkbox");
    fireEvent.click(toc);
    expect(updateSettings).toHaveBeenCalledWith("print.includeToc", true);
    fireEvent.click(background);
    expect(updateSettings).toHaveBeenCalledWith("print.includeBackground", true);
  });
});
