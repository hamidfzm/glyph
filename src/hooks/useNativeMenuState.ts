import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isMobilePlatform } from "@/lib/platform";

export interface NativeMenuFlags {
  hasTab: boolean;
  hasFile: boolean;
  hasContent: boolean;
  /** A folder workspace is active (folder or graph tab), so workspace-wide
   *  views like Open Graph make sense. */
  hasWorkspace: boolean;
  aiConfigured: boolean;
  ttsAvailable: boolean;
}

// Keeps native menu items in sync with what the user can actually do.
// The backend starts with every conditional item disabled; this hook
// reasserts the state whenever any input changes.
export function useNativeMenuState(flags: NativeMenuFlags) {
  const { hasTab, hasFile, hasContent, hasWorkspace, aiConfigured, ttsAvailable } = flags;
  useEffect(() => {
    // No native menu (or set_menu_state command) exists on mobile.
    if (isMobilePlatform()) return;
    (async () => {
      try {
        await invoke("set_menu_state", {
          flags: { hasTab, hasFile, hasContent, hasWorkspace, aiConfigured, ttsAvailable },
        });
      } catch (err) {
        console.error("Failed to update menu state:", err);
      }
    })();
  }, [hasTab, hasFile, hasContent, hasWorkspace, aiConfigured, ttsAvailable]);
}
