import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { currentPlatform, isMobile, isMobilePlatform } from "@/lib/platform";
import { subscribe } from "@/lib/tauriEvent";

export interface NativeMenuFlags {
  hasTab: boolean;
  hasFile: boolean;
  hasContent: boolean;
  /** A folder workspace is active (folder or graph tab), so workspace-wide
   *  views like Open Graph make sense. */
  hasWorkspace: boolean;
  aiConfigured: boolean;
  ttsAvailable: boolean;
  hasDirty: boolean;
  autoSave: boolean;
}

// Keeps native menu items in sync with what the user can actually do.
// The backend starts with every conditional item disabled; this hook
// reasserts the state whenever any input changes or the window gains focus.
export function useNativeMenuState(flags: NativeMenuFlags) {
  const {
    hasTab,
    hasFile,
    hasContent,
    hasWorkspace,
    aiConfigured,
    ttsAvailable,
    hasDirty,
    autoSave,
  } = flags;
  const pushRef = useRef(async () => {});

  useEffect(() => {
    // No native menu (or set_menu_state command) exists on mobile.
    if (isMobilePlatform()) return;
    const push = async () => {
      try {
        await invoke("set_menu_state", {
          flags: {
            hasTab,
            hasFile,
            hasContent,
            hasWorkspace,
            aiConfigured,
            ttsAvailable,
            hasDirty,
            autoSave,
          },
        });
      } catch (err) {
        console.error("Failed to update menu state:", err);
      }
    };
    pushRef.current = push;
    void push();
  }, [hasTab, hasFile, hasContent, hasWorkspace, aiConfigured, ttsAvailable, hasDirty, autoSave]);

  // Every desktop platform but Windows shares one app menu between windows, so
  // it holds the last window's push; the window gaining focus reasserts its own.
  useEffect(() => {
    const platform = currentPlatform();
    if (platform === "windows" || isMobile(platform)) return;

    // Focus events can arrive in bursts: one push in flight, at most one queued.
    let pushing = false;
    let queued = false;
    let disposed = false;
    const handleFocus = async () => {
      if (pushing) {
        queued = true;
        return;
      }
      pushing = true;
      await pushRef.current();
      pushing = false;
      if (!queued || disposed) return;
      queued = false;
      void handleFocus();
    };
    const unsubscribe = subscribe("tauri://focus", handleFocus);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
