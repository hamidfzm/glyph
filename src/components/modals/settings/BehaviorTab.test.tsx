import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { BehaviorTab } from "./BehaviorTab";

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
  render(<BehaviorTab />, { wrapper });
  return { updateSettings };
}

describe("BehaviorTab", () => {
  it("toggles each file-handling option", () => {
    const { updateSettings } = setup();

    const [autoReload, reopen, confirmLinks] = screen.getAllByRole("checkbox");
    fireEvent.click(autoReload);
    expect(updateSettings).toHaveBeenCalledWith("behavior.autoReload", false);
    fireEvent.click(reopen);
    expect(updateSettings).toHaveBeenCalledWith("behavior.reopenLastFile", true);
    fireEvent.click(confirmLinks);
    expect(updateSettings).toHaveBeenCalledWith("behavior.confirmExternalLinks", false);
  });

  it("lists recent files and clears them", () => {
    const { updateSettings } = setup({
      ...DEFAULT_SETTINGS,
      behavior: { ...DEFAULT_SETTINGS.behavior, recentFiles: ["/p/a.md", "/p/b.md"] },
    });
    expect(screen.getByText("/p/a.md")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Clear Recent Files/i));
    expect(updateSettings).toHaveBeenCalledWith("behavior.recentFiles", []);
  });
});
