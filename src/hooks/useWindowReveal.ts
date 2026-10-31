import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useSettings } from "@/hooks/useSettings";
import { getCliExportRequest } from "@/lib/cliExport";
import { getCliServeRequest } from "@/lib/cliServe";

/**
 * Reveals the main window once the app is ready to be seen.
 *
 * The window is created hidden (`visible: false` in tauri.conf.json) so the
 * user never sees the blank white native window before the webview paints, nor
 * the geometry jump from the window-state plugin restoring size/position. We
 * wait until the persisted settings and the plugins (a color scheme or another
 * plugin stylesheet restyles the app) are loaded, let the browser paint one
 * themed frame, then show and focus the window.
 *
 * A timeout from the settings load acts as a safety net so the window is never
 * left hidden if anything above stalls.
 */
export function useWindowReveal() {
  const { loaded } = useSettings();
  const pluginsLoaded = usePluginsOptional()?.initialLoadDone ?? true;
  // Survives the effect re-running when the plugins finish after the timeout.
  const revealedRef = useRef(false);

  useEffect(() => {
    if (!loaded) return;

    let cancelled = false;
    let raf = 0;
    let timer = 0;
    const reveal = () => {
      if (revealedRef.current || cancelled) return;
      revealedRef.current = true;
      try {
        const win = getCurrentWindow();
        void win
          .show()
          .then(() => win.setFocus())
          .catch(() => {});
      } catch {
        // The window API is unavailable (e.g. a non-Tauri or test
        // environment); there is nothing to reveal.
      }
    };

    // A headless CLI export and a `glyph serve` process must never surface
    // the window: both are renderers, not an app the user opened. Everyone
    // else reveals after a painted frame, with a timeout safety net in case
    // rAF never fires.
    void Promise.all([getCliExportRequest(), getCliServeRequest()]).then(
      ([cliExport, cliServe]) => {
        if (cliExport || cliServe || cancelled) return;
        if (pluginsLoaded) raf = requestAnimationFrame(() => requestAnimationFrame(reveal));
        timer = window.setTimeout(reveal, 1000);
      },
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [loaded, pluginsLoaded]);
}
