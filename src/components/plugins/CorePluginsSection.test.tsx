import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext } from "@/contexts/PluginsContext";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { SettingsPanelContribution } from "@/lib/plugins/types";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
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

  it("lists the tags and backlinks plugins with their own settings", () => {
    const value = renderSection(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Tags" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Backlinks" }));
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.tags", false);
    expect(value.updateSettings).toHaveBeenCalledWith("corePlugins.backlinks", false);
  });

  it("shows a core plugin's settings panel under its row while it is registered", () => {
    const settingsPanels = createRegistry<SettingsPanelContribution>();
    const removePanel = settingsPanels.register({
      pluginId: "glyph.core.d2",
      id: "d2-settings",
      mount: (el) => {
        el.textContent = "layout engine";
      },
    });
    // A community plugin's panel belongs to its own row in the list below.
    settingsPanels.register({
      pluginId: "com.x.demo",
      id: "demo-settings",
      mount: (el) => {
        el.textContent = "demo option";
      },
    });
    render(
      <PluginsContext.Provider value={pluginsContextValue({ settingsPanels })}>
        <CorePluginsSection />
      </PluginsContext.Provider>,
    );
    expect(screen.getByText("layout engine")).toBeInTheDocument();
    expect(screen.queryByText("demo option")).not.toBeInTheDocument();

    // Turning the plugin off unloads it, which removes the panel.
    act(() => removePanel());
    expect(screen.queryByText("layout engine")).not.toBeInTheDocument();
  });
});
