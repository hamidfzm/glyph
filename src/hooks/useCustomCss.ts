import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

const STYLE_ID = "glyph-custom-css";

/**
 * Inject the user's `custom.css` (app config dir) into the document head after
 * the app's own styles, so user rules win ties. Re-reads whenever the setting
 * toggles on; removes the element when off or when the file doesn't exist.
 * Gated on `loaded` so a toggle persisted as on applies exactly once settings
 * arrive, not against defaults.
 */
export function useCustomCss(enabled: boolean, loaded: boolean) {
  useEffect(() => {
    if (!loaded) return;
    if (!enabled) {
      document.getElementById(STYLE_ID)?.remove();
      return;
    }
    let cancelled = false;
    invoke<string | null>("read_custom_css")
      .then((css) => {
        if (cancelled) return;
        if (!css) {
          document.getElementById(STYLE_ID)?.remove();
          return;
        }
        let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
      })
      .catch((err) => console.error("Failed to load custom.css:", err));
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);
}
