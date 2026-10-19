import highContrast from "./high-contrast.css?inline";
import sepia from "./sepia.css?inline";
import solarized from "./solarized.css?inline";

// Each preset sets every token the app's light and dark themes set, and the
// macOS sidebar tint only on macOS: elsewhere the sidebar is opaque and follows
// the surface tokens.
export const PRESET_CSS = {
  sepia,
  solarized,
  "high-contrast": highContrast,
};

export type PresetId = "none" | keyof typeof PRESET_CSS;

/** Every choice, in the order the picker lists them. */
export const PRESET_IDS: readonly PresetId[] = ["none", ...(Object.keys(PRESET_CSS) as PresetId[])];

/** The stored preset, or "none" for anything this version does not ship. */
export function readPreset(stored: unknown): PresetId {
  return PRESET_IDS.find((preset) => preset === stored) ?? "none";
}
