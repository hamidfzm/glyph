import type { CorePluginSettings } from "@/lib/settings";
import { PLUGIN_API_VERSION } from "./apiVersion";
import type { InstalledPlugin, PluginModule, PluginPermission } from "./types";

export interface CorePlugin {
  /** Under the `glyph.core.` prefix the backend refuses for installed plugins. */
  id: string;
  settingsKey: keyof CorePluginSettings;
  /** Granted without a prompt: the plugin ships in the signed app. */
  permissions?: readonly PluginPermission[];
  /** The dynamic import is the chunk gate: a disabled core plugin never loads its code. */
  load: () => Promise<{ default: PluginModule }>;
}

// Core-ness comes only from this compiled-in list, never from disk or
// plugins.json. Core plugins ship in the signed app, so they load with full
// trust and no consent prompt, and cannot be removed or updated on their own.
// They have no plugin folder, so ctx.assets refuses them; ship data in the
// bundle instead. The order here is the order of the Settings rows and of the
// blocks core plugins place in the Files panel.
export const CORE_PLUGINS: readonly CorePlugin[] = [
  { id: "glyph.core.d2", settingsKey: "d2", load: () => import("@/plugins/core/d2/d2Plugin") },
  {
    id: "glyph.core.mermaid",
    settingsKey: "mermaid",
    load: () => import("@/plugins/core/mermaid/mermaidPlugin"),
  },
  {
    id: "glyph.core.math",
    settingsKey: "math",
    load: () => import("@/plugins/core/math/mathPlugin"),
  },
  {
    id: "glyph.core.tags",
    settingsKey: "tags",
    permissions: ["workspace:read"],
    load: () => import("@/plugins/core/tags/tagsPlugin"),
  },
  {
    id: "glyph.core.backlinks",
    settingsKey: "backlinks",
    permissions: ["workspace:read"],
    load: () => import("@/plugins/core/backlinks/backlinksPlugin"),
  },
  {
    id: "glyph.core.daily-notes",
    settingsKey: "dailyNotes",
    permissions: ["workspace:read", "workspace:write"],
    load: () => import("@/plugins/core/daily-notes/dailyNotesPlugin"),
  },
];

/** The host entry for a core plugin: bundled, so there is no folder or source text. */
export function coreInstalledPlugin(core: CorePlugin): InstalledPlugin {
  return {
    id: core.id,
    name: core.id,
    version: PLUGIN_API_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    permissions: core.permissions ? [...core.permissions] : undefined,
    sandbox: false,
    dir: "",
    mainSource: "",
  };
}
