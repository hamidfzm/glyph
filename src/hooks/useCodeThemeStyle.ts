import { useEffect } from "react";
import glyphThemeCSS from "@/styles/highlight.css?inline";
import githubThemeCSS from "@/styles/highlight-github.css?inline";
import monokaiThemeCSS from "@/styles/highlight-monokai.css?inline";
import nordThemeCSS from "@/styles/highlight-nord.css?inline";
import solarizedDarkThemeCSS from "@/styles/highlight-solarized-dark.css?inline";
import solarizedLightThemeCSS from "@/styles/highlight-solarized-light.css?inline";

const CODE_THEMES: Record<string, string> = {
  glyph: glyphThemeCSS,
  github: githubThemeCSS,
  monokai: monokaiThemeCSS,
  nord: nordThemeCSS,
  "solarized-light": solarizedLightThemeCSS,
  "solarized-dark": solarizedDarkThemeCSS,
};

const STYLE_ID = "glyph-code-theme";

// Apply the user's chosen syntax-highlight palette by injecting the matching
// stylesheet into a single managed <style> element in the document head.
export function useCodeThemeStyle(codeTheme: string) {
  useEffect(() => {
    const themeCSS = CODE_THEMES[codeTheme] ?? CODE_THEMES.glyph;
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = themeCSS;
  }, [codeTheme]);
}
