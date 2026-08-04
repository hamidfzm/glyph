import { load, type Store } from "@tauri-apps/plugin-store";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { KEYED_PROVIDERS, setAiKey } from "@/lib/aiKeys";
import { applyCSSVariables, applyTheme } from "@/lib/applySettingsToDom";
import { DEFAULT_SETTINGS, type Settings, stripSecrets } from "@/lib/settings";
import { migrateLegacySettings } from "@/lib/settingsMigrations";
import { deepMerge, setNestedValue } from "@/lib/settingsObject";
import { loadSecrets } from "@/lib/settingsSecrets";
import { SettingsContext } from "./SettingsContext";

const STORE_KEY = "settings";
const SAVE_DEBOUNCE = 500;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef<Store | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Settings | null>(null);
  const writeChainRef = useRef<Promise<boolean>>(Promise.resolve(true));

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
        const merged = await loadSecrets(store, STORE_KEY, base);
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
  // flush can retry. Writes are serialized through writeChainRef so a flush
  // cannot overlap an in-flight debounced write and land the older value last.
  const writePending = useCallback(() => {
    const write = async () => {
      const store = storeRef.current;
      const pending = pendingRef.current;
      if (!store || !pending) return true;
      try {
        await store.set(STORE_KEY, stripSecrets(pending));
        // save() awaits the disk write; the store plugin's own autosave
        // debounce could still be pending when the process exits.
        await store.save();
        // A newer update may have arrived while awaiting; keep it pending.
        if (pendingRef.current === pending) pendingRef.current = null;
        return true;
      } catch (err) {
        console.error("Failed to save settings:", err);
        return false;
      }
    };
    const next = writeChainRef.current.then(write);
    writeChainRef.current = next;
    return next;
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

  // Gate children on loaded: a mount-time settings write would persist
  // DEFAULT_SETTINGS over the stored settings (#490); reveal waits for load anyway.
  return (
    <SettingsContext value={{ settings, updateSettings, resetSettings, flushSettings, loaded }}>
      {loaded ? children : null}
    </SettingsContext>
  );
}
