import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";
import type { ColorSchemeSetting } from "@/lib/settings";
import { getNestedValue } from "@/lib/settingsObject";

// The theme presets plugin kept its pick in plugins.json until the choice
// moved to the Appearance setting.
const PLUGIN_ID = "glyph.core.theme-presets";

// The labels are shown only while the plugin is off, which is when its own
// translated names are out of reach.
const PRESETS = [
  ["sepia", "Sepia"],
  ["solarized", "Solarized"],
  ["high-contrast", "High contrast"],
] as const;

/** The scheme a stored preset carries over to; null for none or anything unknown. */
export function legacyPresetScheme(
  pluginSettings: Record<string, unknown>,
): ColorSchemeSetting | null {
  const match = PRESETS.find(([preset]) => preset === pluginSettings.preset);
  if (!match) return null;
  const [preset, label] = match;
  return { id: `${PLUGIN_ID}:${preset}`, label };
}

/**
 * The scheme to seed `appearance.colorScheme` with, read only while the stored
 * settings have none, so a second run (or a choice made since) changes nothing.
 */
export async function carriedOverColorScheme(
  storedSettings: unknown,
): Promise<ColorSchemeSetting | null> {
  const stored = storedSettings as Record<string, unknown>;
  if (getNestedValue(stored, "appearance.colorScheme") !== undefined) return null;
  return legacyPresetScheme(await loadPluginSettings(PLUGIN_ID));
}

/** Drop the carried-over preset; call only once the new setting is on disk. */
export async function removeLegacyPreset(): Promise<void> {
  const { preset: _carriedOver, ...rest } = await loadPluginSettings(PLUGIN_ID);
  await savePluginSettings(PLUGIN_ID, rest);
}
