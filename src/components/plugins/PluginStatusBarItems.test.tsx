import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  FencedRendererContribution,
  MarkdownPlugin,
  StatusBarItemContribution,
} from "@/lib/plugins/types";
import { PluginStatusBarItems } from "./PluginStatusBarItems";

function value(statusBarItems = createRegistry<StatusBarItemContribution>()): PluginsContextValue {
  return {
    commands: createRegistry<CommandContribution>(),
    statusBarItems,
    remarkPlugins: createRegistry<MarkdownPlugin>(),
    rehypePlugins: createRegistry<MarkdownPlugin>(),
    fencedRenderers: createRegistry<FencedRendererContribution>(),
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

describe("PluginStatusBarItems", () => {
  it("renders nothing without a provider", () => {
    const { container } = render(<PluginStatusBarItems />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no items are registered", () => {
    const { container } = render(
      <PluginsContext.Provider value={value()}>
        <PluginStatusBarItems />
      </PluginsContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a slot per registered item", () => {
    const items = createRegistry<StatusBarItemContribution>();
    items.register({
      id: "it1",
      mount: (el) => {
        el.textContent = "A";
      },
    });
    const { container } = render(
      <PluginsContext.Provider value={value(items)}>
        <PluginStatusBarItems />
      </PluginsContext.Provider>,
    );
    expect(container.querySelector('[data-plugin-slot="it1"]')?.textContent).toBe("A");
  });
});
