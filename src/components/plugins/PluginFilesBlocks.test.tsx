import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginsContext } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type { SidebarPanelEntry } from "@/lib/plugins/types";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";
import { PluginFilesBlocks } from "./PluginFilesBlocks";

function block(pluginId: string, id: string, title: string): SidebarPanelEntry {
  return { pluginId, id, title, location: "files", mount: () => {} };
}

function renderBlocks(sidebarPanels = createRegistry<SidebarPanelEntry>()) {
  return render(
    <PluginsContext.Provider value={pluginsContextValue({ sidebarPanels })}>
      <PluginFilesBlocks />
    </PluginsContext.Provider>,
  );
}

function headings() {
  return screen.getAllByRole("button").map((button) => button.textContent);
}

describe("PluginFilesBlocks", () => {
  it("renders nothing without a provider or without blocks", () => {
    expect(render(<PluginFilesBlocks />).container.firstChild).toBeNull();
    expect(renderBlocks().container.firstChild).toBeNull();
  });

  it("leaves panels placed below the outline to the outline", () => {
    const panels = createRegistry<SidebarPanelEntry>();
    panels.register({ pluginId: "com.x.todo", id: "todo", title: "TODOs", mount: () => {} });
    expect(renderBlocks(panels).container.firstChild).toBeNull();
  });

  it("stacks core blocks in the order of the core list, then the rest", () => {
    const panels = createRegistry<SidebarPanelEntry>();
    panels.register(block("com.x.notes", "notes", "Notes"));
    panels.register(block("glyph.core.backlinks", "backlinks", "Backlinks"));
    panels.register(block("glyph.core.tags", "tags", "Tags"));
    renderBlocks(panels);
    expect(headings()).toEqual(["▾Tags", "▾Backlinks", "▾Notes"]);
  });

  it("drops a block when its plugin is turned off", () => {
    const panels = createRegistry<SidebarPanelEntry>();
    panels.register(block("glyph.core.tags", "tags", "Tags"));
    const removeBacklinks = panels.register(
      block("glyph.core.backlinks", "backlinks", "Backlinks"),
    );
    renderBlocks(panels);

    act(() => removeBacklinks());
    expect(headings()).toEqual(["▾Tags"]);
  });
});
