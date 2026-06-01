import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { LayoutTab } from "./LayoutTab";

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
  render(<LayoutTab />, { wrapper });
  return { updateSettings };
}

describe("LayoutTab", () => {
  it("updates every sidebar control", () => {
    const { updateSettings } = setup();

    // Checkbox order matches the JSX: files, outline, swap.
    const [files, outline, swap] = screen.getAllByRole("checkbox");
    fireEvent.click(files);
    expect(updateSettings).toHaveBeenCalledWith("layout.filesSidebarVisible", false);
    fireEvent.click(outline);
    expect(updateSettings).toHaveBeenCalledWith("layout.outlineSidebarVisible", false);
    fireEvent.click(swap);
    expect(updateSettings).toHaveBeenCalledWith("layout.swapSidebarSides", true);

    fireEvent.click(screen.getByRole("button", { name: "Combined" }));
    expect(updateSettings).toHaveBeenCalledWith("layout.sidebarLayout", "combined");

    fireEvent.change(screen.getByRole("slider"), { target: { value: "200" } });
    expect(updateSettings).toHaveBeenCalledWith("layout.sidebarWidth", 200);
  });
});
