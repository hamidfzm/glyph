import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";

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

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
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

    // Show after a painted frame so the first visible frame is fully themed.
    const raf = requestAnimationFrame(() => requestAnimationFrame(reveal));
    // Safety net in case rAF never fires (e.g. window not focused on some OSes).
    const timer = window.setTimeout(reveal, 1000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [loaded]);
}
