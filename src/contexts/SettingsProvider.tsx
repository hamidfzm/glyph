import { load, type Store } from "@tauri-apps/plugin-store";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { KEYED_PROVIDERS, loadAiKeys, setAiKey } from "@/lib/aiKeys";
import {
  CONTENT_WIDTH_MAP,
  DEFAULT_SETTINGS,
  FONT_FAMILY_MAP,
  LINE_HEIGHT_MAP,
  type Settings,
  stripSecrets,
} from "@/lib/settings";
import { migrateLegacySettings } from "@/lib/settingsMigrations";
import { deepMerge, setNestedValue } from "@/lib/settingsObject";
import { SettingsContext } from "./SettingsContext";

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

/**
 * Move any legacy plaintext API keys from settings.json into the OS keychain,
 * then overlay the keychain's stored keys onto the in-memory settings. The
 * plaintext copy is removed from the store only once every key migrated, so a
 * locked keyring never destroys the only copy of a key; every subsequent store
 * write is stripped regardless (see saveToStore). Never throws.
 */
async function loadSecrets(store: Store, merged: Settings): Promise<Settings> {
  const legacy = merged.ai.apiKeys;
  const legacyProviders = KEYED_PROVIDERS.filter((p) => legacy[p]);
  let migrated = true;
  for (const provider of legacyProviders) {
    try {
      await setAiKey(provider, legacy[provider]);
    } catch (err) {
      migrated = false;
      console.error(`Failed to migrate the ${provider} API key to the keychain:`, err);
    }
  }
  const withKeys: Settings = {
    ...merged,
    ai: { ...merged.ai, apiKeys: { ...legacy, ...(await loadAiKeys()) } },
  };
  if (legacyProviders.length > 0 && migrated) {
    try {
      await store.set(STORE_KEY, stripSecrets(withKeys));
    } catch (err) {
      console.error("Failed to remove migrated API keys from settings.json:", err);
    }
  }
  return withKeys;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef<Store | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Settings | null>(null);

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
        const base = saved
          ? (deepMerge(
              DEFAULT_SETTINGS as unknown as Record<string, unknown>,
              migrateLegacySettings(saved as unknown as Record<string, unknown>),
            ) as unknown as Settings)
          : DEFAULT_SETTINGS;
        // API keys live in the OS keychain, not the store: migrate any legacy
        // plaintext keys out of settings.json and load the stored ones.
        const merged = await loadSecrets(store, base);
        if (!cancelled) {
          setSettings(merged);
          applyTheme(merged.appearance.theme);
          applyCSSVariables(merged);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        applyTheme(DEFAULT_SETTINGS.appearance.theme);
        applyCSSVariables(DEFAULT_SETTINGS);
      }
      if (!cancelled) setLoaded(true);
    }

    init();
    return () => {
      cancelled = true;
    };
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

  // Write the latest pending settings to the store and disk. Secrets never
  // reach the store: every write persists a stripped copy, so settings.json
  // cannot contain API keys. On failure the pending value is kept so a later
  // flush can retry.
  const writePending = useCallback(async () => {
    const store = storeRef.current;
    const pending = pendingRef.current;
    if (!store || !pending) return true;
    try {
      await store.set(STORE_KEY, stripSecrets(pending));
      // save() awaits the disk write; autoSave's own debounce could still be
      // pending when the process exits.
      await store.save();
      // A newer update may have arrived while awaiting; keep it pending.
      if (pendingRef.current === pending) pendingRef.current = null;
      return true;
    } catch (err) {
      console.error("Failed to save settings:", err);
      return false;
    }
  }, []);

  // Save settings to store (debounced).
  const saveToStore = useCallback(
    (newSettings: Settings) => {
      pendingRef.current = newSettings;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void writePending();
      }, SAVE_DEBOUNCE);
    },
    [writePending],
  );

  // Persist any update still inside the debounce window; called before the
  // window is allowed to close so a just-changed setting is not lost.
  const flushSettings = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return writePending();
  }, [writePending]);

  // Unmount (tests, hot reload) clears the timer without abandoning the
  // pending update.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void writePending();
    };
  }, [writePending]);

  const updateSettings = useCallback(
    (path: string, value: unknown) => {
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
    },
    [saveToStore],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS.appearance.theme);
    applyCSSVariables(DEFAULT_SETTINGS);
    saveToStore(DEFAULT_SETTINGS);
    // Reset clears the in-memory keys, so drop the keychain copies too or the
    // "cleared" keys would silently reappear on the next launch.
    for (const provider of KEYED_PROVIDERS) {
      setAiKey(provider, "").catch((err) => {
        console.error(`Failed to clear the ${provider} API key from the keychain:`, err);
      });
    }
  }, [saveToStore]);

  return (
    <SettingsContext value={{ settings, updateSettings, resetSettings, flushSettings, loaded }}>
      {children}
    </SettingsContext>
  );
}
