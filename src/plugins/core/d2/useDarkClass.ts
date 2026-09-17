import { useEffect, useState } from "react";

/**
 * Whether the app is showing its dark theme: the `.dark` class on `<html>`,
 * which settings can set against the OS preference, so the media query is not
 * the source of truth. Observed so a theme switch re-renders the diagram.
 */
export function useDarkClass(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
