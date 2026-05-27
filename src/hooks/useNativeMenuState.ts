import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

export interface NativeMenuFlags {
  hasTab: boolean;
  hasFile: boolean;
  hasContent: boolean;
  aiConfigured: boolean;
  ttsAvailable: boolean;
  // Mirrors the `experimental.cloudSync` setting. When false the backend
  // hides the File > Cloud Sync menu item entirely.
  cloudSyncEnabled: boolean;
}

// Keeps native menu items in sync with what the user can actually do.
// The backend starts with every conditional item disabled; this hook
// reasserts the state whenever any input changes.
export function useNativeMenuState(flags: NativeMenuFlags) {
  const { hasTab, hasFile, hasContent, aiConfigured, ttsAvailable, cloudSyncEnabled } = flags;
  useEffect(() => {
    (async () => {
      try {
        await invoke("set_menu_state", {
          flags: { hasTab, hasFile, hasContent, aiConfigured, ttsAvailable, cloudSyncEnabled },
        });
      } catch (err) {
        console.error("Failed to update menu state:", err);
      }
    })();
  }, [hasTab, hasFile, hasContent, aiConfigured, ttsAvailable, cloudSyncEnabled]);
}
