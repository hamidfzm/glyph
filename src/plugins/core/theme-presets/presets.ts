import highContrast from "./high-contrast.css?inline";
import sepia from "./sepia.css?inline";
import solarized from "./solarized.css?inline";

// Each preset sets every token the app's light and dark themes set, and the
// macOS sidebar tint only on macOS: elsewhere the sidebar is opaque and follows
// the surface tokens. The keys are the scheme ids the app stores, in the order
// the picker lists them.
export const PRESET_CSS = {
  sepia,
  solarized,
  "high-contrast": highContrast,
};
