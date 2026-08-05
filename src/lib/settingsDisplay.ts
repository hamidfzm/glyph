// How appearance settings are rendered: the CSS values each named option maps
// to, and the model names suggested per AI provider. Kept out of settings.ts so
// that file stays the settings shape plus its defaults.

import type { AISettings } from "@/lib/settings";

export const ZOOM_DEFAULT = 16;

export const FONT_FAMILY_MAP: Record<string, string> = {
  system: "",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

export const LINE_HEIGHT_MAP: Record<string, string> = {
  compact: "1.5",
  normal: "1.7",
  relaxed: "2.0",
};

export const CONTENT_WIDTH_MAP: Record<string, string> = {
  narrow: "640px",
  medium: "800px",
  wide: "1024px",
  full: "100%",
};

// Keyed by every provider, "none" included, so the model field can index it
// without a fallback branch.
export const MODEL_SUGGESTIONS: Record<AISettings["provider"], string[]> = {
  none: [],
  claude: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: ["llama3.2", "mistral", "gemma2"],
};
