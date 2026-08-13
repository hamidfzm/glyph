import { setTheme as setNativeTheme } from "@tauri-apps/api/app";
import type { Settings } from "@/lib/settings";
import { CONTENT_WIDTH_MAP, LINE_HEIGHT_MAP, resolveReadingFont } from "@/lib/settingsDisplay";

// Pushes appearance settings onto the document: the dark class plus the native
// window chrome, and the `--glyph-*` custom properties the stylesheets read.

export function applyTheme(theme: Settings["appearance"]["theme"]) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);
  } else {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
  // Native window chrome (Linux CSD, Windows frame) keeps its launch theme unless told; null follows the OS.
  setNativeTheme(theme === "system" ? null : theme).catch((err) => {
    console.error("Failed to set the native window theme:", err);
  });
}

export function applyCSSVariables(settings: Settings) {
  const root = document.documentElement.style;
  const { appearance } = settings;

  // Prose only: chrome stays on --glyph-font. Always written or always cleared,
  // so no transition strands prose on a face the settings no longer name.
  const readingFont = resolveReadingFont(appearance);
  if (readingFont) {
    root.setProperty("--glyph-reading-font", readingFont);
  } else {
    root.removeProperty("--glyph-reading-font");
  }

  // Font size
  root.setProperty("--glyph-font-size", `${appearance.fontSize}px`);

  // Line height
  root.setProperty("--glyph-line-height", LINE_HEIGHT_MAP[appearance.lineHeight] ?? "1.7");

  // Content width
  root.setProperty("--glyph-content-width", CONTENT_WIDTH_MAP[appearance.contentWidth] ?? "800px");

  // Code font
  if (appearance.codeFont) {
    root.setProperty("--glyph-code-font", appearance.codeFont);
  } else {
    root.removeProperty("--glyph-code-font");
  }
}
