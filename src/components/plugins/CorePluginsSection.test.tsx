import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { CorePluginsSection } from "./CorePluginsSection";

function renderSection(d2: boolean) {
  const value: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...DEFAULT_SETTINGS.corePlugins, d2 } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  render(
    <SettingsContext.Provider value={value}>
      <CorePluginsSection />
    </SettingsContext.Provider>,
  );
  return value;
}

describe("CorePluginsSection", () => {
  it("lists each core plugin with a toggle bound to its setting", () => {
    const value = renderSection(true);
    const toggle = screen.getByRole("checkbox", { name: "Enable D2 diagrams" });
    expect(screen.getByText("Core plugins")).toBeInTheDocument();
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.d2", false);
  });

  it("lists Mermaid with its own setting", () => {
    const value = renderSection(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Mermaid diagrams" }));
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.mermaid", false);
  });

  it("lists Math with its own setting", () => {
    const value = renderSection(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Math (KaTeX)" }));
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.math", false);
  });

  it("switches a disabled core plugin back on", () => {
    const value = renderSection(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable D2 diagrams" }));
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.d2", true);
  });
});
