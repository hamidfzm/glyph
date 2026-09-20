import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { CORE_PLUGINS, coreInstalledPlugin } from "@/lib/plugins/corePlugins";
import type { PluginHost } from "@/lib/plugins/host";

/**
 * Keeps the host's core plugins in line with their Settings toggles: loads the
 * enabled ones and unloads the rest, at startup and on every toggle, with no
 * restart. Returns whether the first pass has settled; community plugins load
 * after it.
 */
export function useCorePlugins(
  host: PluginHost,
  pushToast: (message: string, tone?: "error") => void,
): boolean {
  const { t } = useTranslation("plugins");
  // A ref, so a language switch does not re-run the load pass (and retry a
  // failed load with another toast).
  const tRef = useRef(t);
  tRef.current = t;
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
          const message = err instanceof Error ? err.message : String(err);
          pushToast(tRef.current("toast.error", { message }), "error");
        }
      }),
    ).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [host, loaded, enabled, pushToast]);

  // Unmount (a closing window, mostly): take the core plugins back down. An
  // import still in flight is superseded by the unload, so a chunk that lands
  // after the app is gone cannot register file types nobody owns any more.
  useEffect(
    () => () => {
      for (const core of CORE_PLUGINS) host.unload(core.id);
    },
    [host],
  );

  return ready;
}
