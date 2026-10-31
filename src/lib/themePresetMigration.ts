import { loadPluginSettings, removePluginSetting } from "@/lib/plugins/settingsStore";
import type { ColorSchemeChoice } from "@/lib/settings";
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
): ColorSchemeChoice | null {
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
): Promise<ColorSchemeChoice | null> {
  const stored = storedSettings as Record<string, unknown>;
  if (getNestedValue(stored, "appearance.colorScheme") !== undefined) return null;
  return legacyPresetScheme(await loadPluginSettings(PLUGIN_ID));
}

/** Drop the carried-over preset once the write holding the new setting lands. */
export async function removeLegacyPresetOnceWritten(write: Promise<boolean>): Promise<void> {
  try {
    if (!(await write)) return;
    await removePluginSetting(PLUGIN_ID, "preset");
  } catch (err) {
    console.error("Failed to remove the carried-over theme preset:", err);
  }
}
