import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  type Settings,
  DEFAULT_SETTINGS,
  FONT_FAMILY_MAP,
  LINE_HEIGHT_MAP,
  CONTENT_WIDTH_MAP,
} from "../lib/settings";

export interface SettingsContextValue {
  settings: Settings;
  updateSettings: (path: string, value: unknown) => void;
  resetSettings: () => void;
  loaded: boolean;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  resetSettings: () => {},
  loaded: false,
});

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...(current[keys[i]] as Record<string, unknown>) };
    current = current[keys[i]] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result;
}

function applyTheme(theme: Settings["appearance"]["theme"]) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);
  } else {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

function applyCSSVariables(settings: Settings) {
  const root = document.documentElement.style;
  const { appearance } = settings;

  // Font family
  if (appearance.fontFamily === "custom" && appearance.customFont) {
    root.setProperty("--glyph-font", appearance.customFont);
  } else if (appearance.fontFamily !== "system") {
    const font = FONT_FAMILY_MAP[appearance.fontFamily];
    if (font) root.setProperty("--glyph-font", font);
  } else {
    root.removeProperty("--glyph-font");
  }

  // Font size
  root.setProperty("--glyph-font-size", `${appearance.fontSize}px`);

  // Line height
  root.setProperty("--glyph-line-height", LINE_HEIGHT_MAP[appearance.lineHeight] ?? "1.7");

  // Content width
  root.setProperty("--glyph-content-width", CONTENT_WIDTH_MAP[appearance.contentWidth] ?? "800px");

  // Code font
  if (appearance.codeFont) {
    root.setProperty("--glyph-code-font", appearance.codeFont);
  } else {
    root.removeProperty("--glyph-code-font");
  }
}

const STORE_KEY = "settings";
const SAVE_DEBOUNCE = 500;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef<Store | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings from store on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const store = await load("settings.json", {
          defaults: {},
          autoSave: true,
        });
        storeRef.current = store;
        const saved = await store.get<Partial<Settings>>(STORE_KEY);
        if (!cancelled && saved) {
          const merged = deepMerge(
            DEFAULT_SETTINGS as unknown as Record<string, unknown>,
            saved as unknown as Record<string, unknown>,
          ) as unknown as Settings;
          setSettings(merged);
          applyTheme(merged.appearance.theme);
          applyCSSVariables(merged);
        } else if (!cancelled) {
          applyTheme(DEFAULT_SETTINGS.appearance.theme);
          applyCSSVariables(DEFAULT_SETTINGS);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        applyTheme(DEFAULT_SETTINGS.appearance.theme);
        applyCSSVariables(DEFAULT_SETTINGS);
      }
      if (!cancelled) setLoaded(true);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Listen for system theme changes when theme is "system"
  useEffect(() => {
    if (settings.appearance.theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.appearance.theme]);

  // Save settings to store (debounced)
  const saveToStore = useCallback((newSettings: Settings) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await storeRef.current?.set(STORE_KEY, newSettings);
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    }, SAVE_DEBOUNCE);
  }, []);

  const updateSettings = useCallback((path: string, value: unknown) => {
    setSettings((prev) => {
      const updated = setNestedValue(
        prev as unknown as Record<string, unknown>,
        path,
        value,
      ) as unknown as Settings;

      // Apply side effects
      if (path.startsWith("appearance.theme")) {
        applyTheme(updated.appearance.theme);
      }
      applyCSSVariables(updated);
      saveToStore(updated);

      return updated;
    });
  }, [saveToStore]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS.appearance.theme);
    applyCSSVariables(DEFAULT_SETTINGS);
    saveToStore(DEFAULT_SETTINGS);
  }, [saveToStore]);

  return (
    <SettingsContext value={{ settings, updateSettings, resetSettings, loaded }}>
      {children}
    </SettingsContext>
  );
}
