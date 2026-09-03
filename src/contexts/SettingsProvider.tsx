import type { Store } from "@tauri-apps/plugin-store";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { KEYED_PROVIDERS, setAiKey } from "@/lib/aiKeys";
import { applyCSSVariables, applyTheme } from "@/lib/applySettingsToDom";
import { DEFAULT_SETTINGS, type Settings, stripSecrets } from "@/lib/settings";
import { setNestedValue } from "@/lib/settingsObject";
import { loadSecrets } from "@/lib/settingsSecrets";
import { mergeChangedPaths, settingsFromStored } from "@/lib/settingsWrite";
import { openStore } from "@/lib/store";
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
  // Which paths this window has changed since its last successful write. Every
  // window writes the whole settings blob from its own snapshot, so without
  // this a second window's write would clobber the first window's change with
  // its own stale copy of that key. Tracking the touched paths lets a write
  // re-read the store and apply only what this window actually changed.
  const changedPathsRef = useRef<Set<string>>(new Set());
  // A reset replaces every key on purpose, so it skips the merge.
  const replaceAllRef = useRef(false);

  // Load settings from store on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const store = await openStore("settings.json");
        storeRef.current = store;
        const saved = await store.get<Partial<Settings>>(STORE_KEY);
        const base = settingsFromStored(saved);
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
  //
  // The write starts from what is on disk right now and re-applies only the
  // paths this window changed, so a setting another window changed while this
  // one was open survives instead of being clobbered by a stale snapshot of it.
  // The read and the write are two IPC calls, so a write landing between them
  // is still lost; that leaves a few milliseconds exposed rather than the whole
  // session, and closing it entirely would mean merging inside the store lock.
  const writePending = useCallback(() => {
    const write = async () => {
      const store = storeRef.current;
      const pending = pendingRef.current;
      if (!store || !pending) return true;
      // A snapshot, not the live set: an update landing mid-write must keep
      // its path queued for the next one.
      const changed = new Set(changedPathsRef.current);
      const replaceAll = replaceAllRef.current;
      try {
        let next = pending;
        if (!replaceAll) {
          next = mergeChangedPaths(await store.get<Partial<Settings>>(STORE_KEY), pending, changed);
        }
        await store.set(STORE_KEY, stripSecrets(next));
        // save() awaits the disk write; the store plugin's own autosave
        // debounce could still be pending when the process exits.
        await store.save();
        // The reset is on disk now, so later writes merge again. Cleared even
        // when a newer update arrived mid-write, which would otherwise leave
        // the flag set and make that next write clobber another window.
        if (replaceAll) replaceAllRef.current = false;
        // A newer update may have arrived while awaiting; keep it pending, and
        // keep the paths it touched so the retry still merges them.
        if (pendingRef.current === pending) {
          pendingRef.current = null;
          for (const path of changed) changedPathsRef.current.delete(path);
        }
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
      changedPathsRef.current.add(path);
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
    // Reset means every key, including ones this window never touched, so the
    // write skips the merge and replaces the stored blob outright.
    replaceAllRef.current = true;
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
