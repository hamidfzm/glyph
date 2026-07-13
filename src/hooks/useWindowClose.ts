import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

/**
 * Intercept the native window-close request (title-bar close, Close Window
 * menu item, application exit) so pending edits are flushed, and confirmed on
 * failure, before the window actually closes.
 *
 * `flush` returns true when it's safe to proceed (everything saved, or the user
 * chose to discard) and false to keep the window open. On approval we re-issue
 * `close()` and let that second request pass through, so the normal close path
 * (window-state geometry save, registry cleanup) still runs.
 */
export function useWindowClose(flush: () => Promise<boolean>) {
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    let win: ReturnType<typeof getCurrentWindow>;
    try {
      win = getCurrentWindow();
    } catch {
      // No window API (non-Tauri or test environment); nothing to intercept.
      return;
    }

    let disposed = false;
    let approved = false;
    let unlisten: (() => void) | undefined;

    win
      .onCloseRequested(async (event) => {
        // The second request is the one we re-issued after approval; let it go.
        if (approved) return;
        event.preventDefault();
        if (await flushRef.current()) {
          approved = true;
          void win.close();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
