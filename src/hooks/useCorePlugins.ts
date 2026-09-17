import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { CORE_PLUGINS, coreInstalledPlugin } from "@/lib/plugins/corePlugins";
import type { PluginHost } from "@/lib/plugins/host";

/**
 * Keeps the host's core plugins in line with their Settings toggles: loads the
 * enabled ones and unloads the rest, at startup and on every toggle, with no
 * restart. Returns whether the first pass has settled, so export readiness can
 * wait for core contributions.
 */
export function useCorePlugins(host: PluginHost): boolean {
  const { settings, loaded } = useSettings();
  const enabled = settings.corePlugins;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const active = new Set(host.listLoaded().map((plugin) => plugin.id));
    void Promise.all(
      CORE_PLUGINS.map(async (core) => {
        // unload also cancels a load still in flight from an earlier toggle.
        if (!enabled[core.settingsKey]) return host.unload(core.id);
        if (active.has(core.id)) return;
        try {
          await host.load(coreInstalledPlugin(core), core.load);
        } catch (err) {
          console.error(`Failed to load core plugin ${core.id}:`, err);
        }
      }),
    ).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [host, loaded, enabled]);

  return ready;
}
