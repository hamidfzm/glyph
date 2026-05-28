import { useEffect, useState } from "react";

/**
 * Reactive boolean that mirrors the `.dark` class on `<html>`. The class is
 * set by `useTheme` / `SettingsContext` (settings can override the OS
 * `prefers-color-scheme`), so for "is the UI currently dark?" the class is
 * the source of truth — not the media query.
 *
 * Observes the class via a `MutationObserver` so consumers re-render when the
 * theme flips (settings change, system toggle, etc.).
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
