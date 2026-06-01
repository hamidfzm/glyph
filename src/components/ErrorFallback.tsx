import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

// Fallback UI rendered by the top-level Sentry ErrorBoundary (see main.tsx)
// when a render error escapes the tree. Presentational, plus one effect: it
// reveals the window itself.
export function ErrorFallback() {
  // The window is created hidden (visible:false in tauri.conf.json) and is
  // normally revealed by useWindowReveal inside AppShell. If the crash happens
  // before that runs, AppShell never mounts, so we reveal here — otherwise this
  // message would render into an invisible window.
  useEffect(() => {
    try {
      const win = getCurrentWindow();
      void win
        .show()
        .then(() => win.setFocus())
        .catch(() => {});
    } catch {
      // Window API unavailable (non-Tauri / test environment); nothing to do.
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
        color: "var(--color-text-secondary)",
      }}
    >
      <p>Something went wrong. Try reopening the file or restarting Glyph.</p>
    </div>
  );
}
