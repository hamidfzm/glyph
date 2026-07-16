import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";
import { resolveBindings } from "@/lib/keybindings";
import { isMobilePlatform } from "@/lib/platform";

// Pushes the resolved keybindings (defaults merged with user overrides) to the
// native menu so its accelerators reflect the user's choices. Runs once settings
// have loaded and again whenever the overrides change.
export function useNativeKeybindings() {
  const { settings, loaded } = useSettings();
  const overrides = settings.keybindings.overrides;

  useEffect(() => {
    if (!loaded) return;
    // No native menu (or apply_keybindings command) exists on mobile.
    if (isMobilePlatform()) return;
    const bindings = Object.fromEntries(resolveBindings(overrides));
    invoke("apply_keybindings", { bindings }).catch((err) => {
      console.error("Failed to apply keybindings to the native menu:", err);
    });
  }, [loaded, overrides]);
}
