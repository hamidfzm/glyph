import type { CorePluginSettings } from "@/lib/settings";
import { PLUGIN_API_VERSION } from "./apiVersion";
import type { InstalledPlugin, PluginModule } from "./types";

export interface CorePlugin {
  /** Under the `glyph.core.` prefix the backend refuses for installed plugins. */
  id: string;
  settingsKey: keyof CorePluginSettings;
  /** The dynamic import is the chunk gate: a disabled core plugin never loads its code. */
  load: () => Promise<{ default: PluginModule }>;
}

// Core-ness comes only from this compiled-in list, never from disk or
// plugins.json. Core plugins ship in the signed app, so they load with full
// trust and no consent prompt, and cannot be removed or updated on their own.
// They have no plugin folder and declare no permissions, so ctx.assets and
// ctx.workspace refuse them; ship data in the bundle instead.
export const CORE_PLUGINS: readonly CorePlugin[] = [
  { id: "glyph.core.d2", settingsKey: "d2", load: () => import("@/plugins/core/d2") },
];

/** The host entry for a core plugin: bundled, so there is no folder or source text. */
export function coreInstalledPlugin(core: CorePlugin): InstalledPlugin {
  return {
    id: core.id,
    name: core.id,
    version: PLUGIN_API_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    sandbox: false,
    dir: "",
    mainSource: "",
  };
}
