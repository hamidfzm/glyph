import type { Store } from "@tauri-apps/plugin-store";
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import { applyCSSVariables, applyTheme } from "@/lib/applySettingsToDom";
import type { Settings } from "@/lib/settings";
import { SETTINGS_SYNCED_EVENT } from "@/lib/settingsSync";
import { mergeChangedPaths, SETTINGS_STORE_KEY } from "@/lib/settingsWrite";
import { subscribe } from "@/lib/tauriEvent";

interface Options {
  loaded: boolean;
  storeRef: RefObject<Store | null>;
  /** Paths this window changed that are not written yet. */
  changedPathsRef: RefObject<Set<string>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
}

/**
 * Re-read settings whenever a settings sync rewrites them on disk, in every
 * window. An edit this window has not written yet stays, as do the API keys,
 * which live in the keychain and never in the store.
 */
export function useSettingsSyncedReload({
  loaded,
  storeRef,
  changedPathsRef,
  setSettings,
}: Options): void {
  useEffect(() => {
    if (!loaded) return;
    let latest = 0;
    return subscribe(SETTINGS_SYNCED_EVENT, () => {
      const store = storeRef.current;
      if (!store) return;
      const reload = ++latest;
      store
        .get<Partial<Settings>>(SETTINGS_STORE_KEY)
        .then((saved) => {
          // A later sync's reload is already on its way.
          if (reload !== latest) return;
          setSettings((prev) => {
            const merged = mergeChangedPaths(saved, prev, changedPathsRef.current);
            const next = { ...merged, ai: { ...merged.ai, apiKeys: prev.ai.apiKeys } };
            applyTheme(next.appearance.theme);
            applyCSSVariables(next);
            return next;
          });
        })
        .catch((err) => console.error("Failed to reload synced settings:", err));
    });
  }, [loaded, storeRef, changedPathsRef, setSettings]);
}
