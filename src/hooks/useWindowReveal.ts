import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";
import { getCliExportRequest } from "@/lib/cliExport";

/**
 * Reveals the main window once the app is ready to be seen.
 *
 * The window is created hidden (`visible: false` in tauri.conf.json) so the
 * user never sees the blank white native window before the webview paints, nor
 * the geometry jump from the window-state plugin restoring size/position. We
 * wait until the persisted settings (and therefore the theme) are loaded, let
 * the browser paint one themed frame, then show and focus the window.
 *
 * A timeout acts as a safety net so the window is never left hidden if anything
 * above stalls.
 */
export function useWindowReveal() {
  const { loaded } = useSettings();

  useEffect(() => {
    if (!loaded) return;

    let cancelled = false;
    let raf = 0;
    let timer = 0;
    let revealed = false;
    const reveal = () => {
      if (revealed || cancelled) return;
      revealed = true;
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

    // A headless CLI export must never surface the window: the process is a
    // renderer, not an app the user opened. Everyone else reveals after a
    // painted frame, with a timeout safety net in case rAF never fires.
    void getCliExportRequest().then((cliExport) => {
      if (cliExport || cancelled) return;
      raf = requestAnimationFrame(() => requestAnimationFrame(reveal));
      timer = window.setTimeout(reveal, 1000);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [loaded]);
}
