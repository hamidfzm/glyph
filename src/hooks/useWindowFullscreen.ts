import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/**
 * Take the OS window fullscreen while the caller is mounted, so an overlay
 * covers the monitor and not just the app window. Restores on unmount unless
 * the window was already fullscreen. The backend command also hides the
 * in-window menu bar meanwhile.
 */
export function useWindowFullscreen(): void {
  useEffect(() => {
    let closed = false;
    let entered = false;
    getCurrentWindow()
      .isFullscreen()
      .then((already) => {
        if (already || closed) return;
        entered = true;
        return invoke("set_overlay_fullscreen", { enter: true });
      })
      .catch(() => {});
    return () => {
      closed = true;
      if (entered) invoke("set_overlay_fullscreen", { enter: false }).catch(() => {});
    };
  }, []);
}
