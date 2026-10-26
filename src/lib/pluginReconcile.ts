import type { RegistryEntry } from "@/lib/plugins/marketplace";
import type { InstalledPlugin } from "@/lib/plugins/types";
import type { PluginPlan, SyncedPlugin } from "@/lib/settingsSync";

/** Why a synced plugin has to be installed by hand on this machine. */
export type ManualReason = "local" | "unlisted";

export interface ManualPlugin {
  plugin: SyncedPlugin;
  reason: ManualReason;
}

/** What the synced plugin list asks of this machine. */
export interface Reconciliation {
  /** Synced marketplace plugins not installed here, with the entry to install from. */
  missing: RegistryEntry[];
  /** Synced plugins this machine cannot install itself. */
  manual: ManualPlugin[];
  /** Installed here, removed from the synced setup on another machine. */
  removals: string[];
  /** On here, off in the synced setup. */
  toDisable: string[];
  /** Off here, on in the synced setup; turning one on may ask for consent. */
  toEnable: InstalledPlugin[];
}

export function reconcilePlugins(
  plan: PluginPlan,
  installed: readonly InstalledPlugin[],
  disabled: readonly string[],
  registry: readonly RegistryEntry[],
): Reconciliation {
  const installedById = new Map(installed.map((p) => [p.id, p]));
  const result: Reconciliation = {
    missing: [],
    manual: [],
    removals: plan.removals.filter((id) => installedById.has(id)),
    toDisable: [],
    toEnable: [],
  };
  for (const plugin of plan.plugins) {
    const here = installedById.get(plugin.id);
    if (here) {
      const isOffHere = disabled.includes(plugin.id);
      if (plugin.enabled && isOffHere) result.toEnable.push(here);
      if (!plugin.enabled && !isOffHere) result.toDisable.push(plugin.id);
      continue;
    }
    if (plugin.source === "local") {
      result.manual.push({ plugin, reason: "local" });
      continue;
    }
    const entry = registry.find((e) => e.id === plugin.id);
    if (entry) {
      result.missing.push(entry);
    } else {
      result.manual.push({ plugin, reason: "unlisted" });
    }
  }
  return result;
}
