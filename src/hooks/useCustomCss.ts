import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { subscribe } from "@/lib/tauriEvent";

const STYLE_ID = "glyph-custom-css";

function apply(css: string | null) {
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
}

/**
 * Inject the user's `custom.css` (app config dir) into the document head after
 * the app's own styles, so user rules win ties. Enabling ensures the file
 * exists, injects it, and watches it so edits apply live; disabling removes
 * the element and the watch. Gated on `loaded` so a persisted-on toggle
 * applies once settings arrive, not against defaults.
 */
export function useCustomCss(enabled: boolean, loaded: boolean) {
  useEffect(() => {
    if (!loaded) return;
    if (!enabled) {
      document.getElementById(STYLE_ID)?.remove();
      return;
    }

    let cancelled = false;
    let watchedPath: string | null = null;

    const readAndApply = () =>
      invoke<string | null>("read_custom_css")
        .then((css) => {
          if (!cancelled) apply(css);
        })
        .catch((err) => console.error("Failed to load custom.css:", err));

    // Live reload: re-read whenever the watcher reports our file changed.
    const unsubscribe = subscribe<string>("file-changed", (event) => {
      if (watchedPath && event.payload === watchedPath) void readAndApply();
    });

    (async () => {
      try {
        // Ensure-then-watch: enabling the setting creates the file so there is
        // always something to open, edit, and watch.
        const path = await invoke<string>("ensure_custom_css");
        if (cancelled) return;
        watchedPath = path;
        await readAndApply();
        await invoke("watch_file", { path });
      } catch (err) {
        console.error("Failed to load custom.css:", err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      if (watchedPath) {
        invoke("unwatch_file", { path: watchedPath }).catch(() => {});
      }
    };
  }, [enabled, loaded]);
}
