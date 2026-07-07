import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  ExporterContribution,
  FencedRendererContribution,
  MarkdownPlugin,
  SettingsPanelContribution,
  SidebarPanelContribution,
  StatusBarItemContribution,
} from "@/lib/plugins/types";
import { PluginSidebarPanels } from "./PluginSidebarPanels";

function value(sidebarPanels = createRegistry<SidebarPanelContribution>()): PluginsContextValue {
  return {
    commands: createRegistry<CommandContribution>(),
    statusBarItems: createRegistry<StatusBarItemContribution>(),
    remarkPlugins: createRegistry<MarkdownPlugin>(),
    rehypePlugins: createRegistry<MarkdownPlugin>(),
    fencedRenderers: createRegistry<FencedRendererContribution>(),
    sidebarPanels,
    settingsPanels: createRegistry<SettingsPanelContribution>(),
    exporters: createRegistry<ExporterContribution>(),
    installed: [],
    disabled: [],
    loaded: [],
    registry: [],
    updates: [],
    installFromFolder: async () => {},
    installFromRegistry: async () => {},
    setEnabled: async () => {},
    uninstall: async () => {},
    setWorkspaceRoot: () => {},
  };
}

describe("PluginSidebarPanels", () => {
  it("renders nothing without a provider or without panels", () => {
    const { container } = render(<PluginSidebarPanels />);
    expect(container.firstChild).toBeNull();

    const { container: withProvider } = render(
      <PluginsContext.Provider value={value()}>
        <PluginSidebarPanels />
      </PluginsContext.Provider>,
    );
    expect(withProvider.firstChild).toBeNull();
  });

  it("renders a titled section per registered panel", () => {
    const panels = createRegistry<SidebarPanelContribution>();
    panels.register({
      id: "todo",
      title: "TODOs",
      mount: (el) => {
        el.textContent = "3 open";
      },
    });
    render(
      <PluginsContext.Provider value={value(panels)}>
        <PluginSidebarPanels />
      </PluginsContext.Provider>,
    );
    expect(screen.getByText("TODOs")).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();
  });
});
