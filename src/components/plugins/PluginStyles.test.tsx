import { render } from "@testing-library/react";
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
  StyleContribution,
} from "@/lib/plugins/types";
import { PluginStyles } from "./PluginStyles";

function value(styles = createRegistry<StyleContribution>()): PluginsContextValue {
  return {
    commands: createRegistry<CommandContribution>(),
    statusBarItems: createRegistry<StatusBarItemContribution>(),
    remarkPlugins: createRegistry<MarkdownPlugin>(),
    rehypePlugins: createRegistry<MarkdownPlugin>(),
    fencedRenderers: createRegistry<FencedRendererContribution>(),
    sidebarPanels: createRegistry<SidebarPanelContribution>(),
    settingsPanels: createRegistry<SettingsPanelContribution>(),
    styles,
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

describe("PluginStyles", () => {
  it("renders nothing without a provider or without styles", () => {
    const { container } = render(<PluginStyles />);
    expect(container.firstChild).toBeNull();

    const { container: withProvider } = render(
      <PluginsContext.Provider value={value()}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    expect(withProvider.firstChild).toBeNull();
  });

  it("renders a style element per contribution, in registration order", () => {
    const styles = createRegistry<StyleContribution>();
    styles.register({ css: "a { color: red }" });
    const dispose = styles.register({ css: "b { color: blue }" });

    const { container, rerender } = render(
      <PluginsContext.Provider value={value(styles)}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    const rendered = [...container.querySelectorAll("style[data-plugin-style]")];
    expect(rendered.map((el) => el.textContent)).toEqual(["a { color: red }", "b { color: blue }"]);

    // Disposing (plugin unload) removes exactly that sheet.
    dispose();
    rerender(
      <PluginsContext.Provider value={value(styles)}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    expect(
      [...container.querySelectorAll("style[data-plugin-style]")].map((el) => el.textContent),
    ).toEqual(["a { color: red }"]);
  });
});
