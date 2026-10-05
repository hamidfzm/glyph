import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { StatusBarItemContribution } from "@/lib/plugins/types";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
import { PluginStatusBarItems } from "./PluginStatusBarItems";

describe("PluginStatusBarItems", () => {
  it("renders nothing without a provider", () => {
    const { container } = render(<PluginStatusBarItems />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no items are registered", () => {
    const { container } = render(
      <PluginsContext.Provider value={pluginsContextValue()}>
        <PluginStatusBarItems />
      </PluginsContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a slot per registered item", () => {
    const statusBarItems = createRegistry<StatusBarItemContribution>();
    statusBarItems.register({
      id: "it1",
      mount: (el) => {
        el.textContent = "A";
      },
    });
    const { container } = render(
      <PluginsContext.Provider value={pluginsContextValue({ statusBarItems })}>
        <PluginStatusBarItems />
      </PluginsContext.Provider>,
    );
    expect(container.querySelector('[data-plugin-slot="it1"]')?.textContent).toBe("A");
  });
});
