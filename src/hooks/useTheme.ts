import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

// Theme for the first render, from the OS preference. Falls back to light
// when there's no window. Exported because the fallback can't be reached
// through the hook: React itself needs a window to render.
export function systemTheme(): Theme {
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function useTheme(override?: "system" | "light" | "dark") {
  const [theme, setTheme] = useState<Theme>(systemTheme);

  useEffect(() => {
    // If settings are managing theme, skip standalone behavior
    if (override) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "dark" : "light");
    };

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [override]);

  useEffect(() => {
    // If settings manage theme, defer to SettingsContext
    if (override) return;

    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme, override]);

  return theme;
}
