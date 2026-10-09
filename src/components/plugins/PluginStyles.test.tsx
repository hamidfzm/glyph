import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { StyleContribution } from "@/lib/plugins/types";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
import { PluginStyles } from "./PluginStyles";

describe("PluginStyles", () => {
  it("renders nothing without a provider or without styles", () => {
    const { container } = render(<PluginStyles />);
    expect(container.firstChild).toBeNull();

    const { container: withProvider } = render(
      <PluginsContext.Provider value={pluginsContextValue()}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    expect(withProvider.firstChild).toBeNull();
  });

  it("renders a style element per contribution, in registration order", () => {
    const styles = createRegistry<StyleContribution>();
    styles.register({ css: "a { color: red }" });
    const dispose = styles.register({ css: "b { color: blue }" });
    const value = pluginsContextValue({ styles });

    const { container, rerender } = render(
      <PluginsContext.Provider value={value}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    const rendered = [...container.querySelectorAll("style[data-plugin-style]")];
    expect(rendered.map((el) => el.textContent)).toEqual(["a { color: red }", "b { color: blue }"]);

    // Disposing (plugin unload) removes exactly that sheet. The registry
    // notifies the mounted subscriber, so the dispose renders and needs act.
    act(() => {
      dispose();
    });
    rerender(
      <PluginsContext.Provider value={value}>
        <PluginStyles />
      </PluginsContext.Provider>,
    );
    expect(
      [...container.querySelectorAll("style[data-plugin-style]")].map((el) => el.textContent),
    ).toEqual(["a { color: red }"]);
  });
});
