import { useEffect } from "react";
import type { PluginHost } from "@/lib/plugins/host";
import { SETTINGS_SYNCED_EVENT, type SettingsSyncedPayload } from "@/lib/settingsSync";
import { subscribe } from "@/lib/tauriEvent";

/**
 * Reload the plugins whose settings a settings sync just rewrote, so each
 * reads its new settings: a loaded plugin keeps the copy it hydrated.
 */
export function useSyncedPluginReload(host: PluginHost): void {
  useEffect(
    () =>
      subscribe<SettingsSyncedPayload>(SETTINGS_SYNCED_EVENT, (event) => {
        void host.reload(event.payload.pluginIds);
      }),
    [host],
  );
}
