import { colorSchemePluginId } from "@/lib/plugins/colorSchemes";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import type { ColorSchemeEntry, InstalledPlugin } from "@/lib/plugins/types";
import { type ColorSchemeSetting, type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { isSafePlainObject } from "@/lib/settingsObject";

const DEFAULT_SCHEME = DEFAULT_SETTINGS.appearance.colorScheme;

/** The stored choice, or Default for anything malformed: settings.json is renderer-writable. */
export function readColorSchemeSetting(value: unknown): ColorSchemeSetting {
  if (!isSafePlainObject(value)) return DEFAULT_SCHEME;
  const { id, label } = value;
  if (typeof id !== "string" || !colorSchemePluginId(id)) return DEFAULT_SCHEME;
  return { id, label: typeof label === "string" && label !== "" ? label : id };
}

/** Why a saved scheme is not applied: its plugin is off, uninstalled, or did not register it. */
export type MissingReason = "off" | "disabled" | "notInstalled" | "unavailable";

export interface ColorSchemeProvider {
  id: string;
  /** Set for a core plugin: its toggle under `corePlugins`. */
  coreKey?: keyof CorePluginSettings;
  /** Set for an installed community plugin. */
  name?: string;
}

export type ColorSchemeStatus =
  | { kind: "default" }
  | { kind: "active"; scheme: ColorSchemeEntry }
  /** Its plugin may still register it: plugins are loading, or a core plugin was just turned on. */
  | { kind: "pending" }
  | { kind: "missing"; reason: MissingReason; provider: ColorSchemeProvider };

interface ColorSchemeInputs {
  saved: ColorSchemeSetting;
  /** One entry per key (see uniqueColorSchemes). */
  schemes: readonly ColorSchemeEntry[];
  initialLoadDone: boolean;
  corePlugins: CorePluginSettings;
  installed: readonly InstalledPlugin[];
  disabled: readonly string[];
}

/**
 * What the saved choice resolves to. Nothing here writes it back, so a scheme
 * whose plugin is missing stays saved and returns when the plugin does.
 */
export function resolveColorScheme(inputs: ColorSchemeInputs): ColorSchemeStatus {
  const { saved, schemes, initialLoadDone } = inputs;
  if (saved.id === DEFAULT_SCHEME.id) return { kind: "default" };
  const scheme = schemes.find((entry) => entry.key === saved.id);
  if (scheme) return { kind: "active", scheme };
  if (!initialLoadDone) return { kind: "pending" };
  const missing = whyMissing(colorSchemePluginId(saved.id), inputs);
  if (!missing) return { kind: "pending" };
  return { kind: "missing", ...missing };
}

function whyMissing(
  pluginId: string,
  { schemes, corePlugins, installed, disabled }: ColorSchemeInputs,
): { reason: MissingReason; provider: ColorSchemeProvider } | null {
  const core = CORE_PLUGINS.find((plugin) => plugin.id === pluginId);
  if (core) {
    const provider = { id: pluginId, coreKey: core.settingsKey };
    if (!corePlugins[core.settingsKey]) return { reason: "off", provider };
    // On with nothing registered yet: still loading since Turn on. A failed
    // load has its own toast.
    if (!schemes.some((entry) => entry.pluginId === pluginId)) return null;
    return { reason: "unavailable", provider };
  }
  const plugin = installed.find((entry) => entry.id === pluginId);
  if (!plugin) return { reason: "notInstalled", provider: { id: pluginId } };
  const provider = { id: pluginId, name: plugin.name };
  if (disabled.includes(pluginId)) return { reason: "disabled", provider };
  return { reason: "unavailable", provider };
}
