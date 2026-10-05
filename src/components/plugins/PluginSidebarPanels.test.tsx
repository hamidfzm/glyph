import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { SidebarPanelEntry } from "@/lib/plugins/types";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
import { PluginSidebarPanels } from "./PluginSidebarPanels";

function renderPanels(sidebarPanels = createRegistry<SidebarPanelEntry>()) {
  return render(
    <PluginsContext.Provider value={pluginsContextValue({ sidebarPanels })}>
      <PluginSidebarPanels />
    </PluginsContext.Provider>,
  );
}

describe("PluginSidebarPanels", () => {
  it("renders nothing without a provider or without panels", () => {
    const { container } = render(<PluginSidebarPanels />);
    expect(container.firstChild).toBeNull();

    expect(renderPanels().container.firstChild).toBeNull();
  });

  it("renders a titled section per registered panel", () => {
    const panels = createRegistry<SidebarPanelEntry>();
    panels.register({
      pluginId: "com.x.todo",
      id: "todo",
      title: "TODOs",
      mount: (el) => {
        el.textContent = "3 open";
      },
    });
    renderPanels(panels);
    expect(screen.getByText("TODOs")).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();
  });

  it("leaves a panel placed in the Files panel to that panel", () => {
    const panels = createRegistry<SidebarPanelEntry>();
    panels.register({
      pluginId: "com.x.links",
      id: "links",
      title: "Links",
      location: "files",
      mount: () => {},
    });
    expect(renderPanels(panels).container.firstChild).toBeNull();
  });
});
