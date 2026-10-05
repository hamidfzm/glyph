import { CORE_PLUGINS } from "./corePlugins";
import type { SidebarPanelEntry } from "./types";

/** Key of a block's saved layout in `layout.blocks`. */
export function filesBlockKey(panel: SidebarPanelEntry): string {
  return `${panel.pluginId}:${panel.id}`;
}

function coreRank(panel: SidebarPanelEntry): number {
  const index = CORE_PLUGINS.findIndex((core) => core.id === panel.pluginId);
  return index === -1 ? CORE_PLUGINS.length : index;
}

/**
 * The panels placed in the Files panel. Core plugins load in parallel and
 * re-register when toggled, so their blocks follow the order of the core list
 * instead of whichever registered first; other plugins keep registration order.
 */
export function filesPanelBlocks(panels: readonly SidebarPanelEntry[]): SidebarPanelEntry[] {
  return panels
    .filter((panel) => panel.location === "files")
    .sort((a, b) => coreRank(a) - coreRank(b));
}
