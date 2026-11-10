import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { type Reconciliation, reconcilePlugins } from "@/lib/pluginReconcile";
import type { PluginPlan } from "@/lib/settingsSync";

const NOTHING: Reconciliation = {
  missing: [],
  manual: [],
  removals: [],
  toDisable: [],
  toEnable: [],
};

export interface PluginReconcile {
  reconciliation: Reconciliation;
  /** The plugin being installed or turned on, while one is. */
  pendingId: string | null;
  install: (id: string) => Promise<void>;
  installAll: () => Promise<void>;
  enable: (id: string) => Promise<void>;
}

/**
 * Bring this machine's plugins in line with the synced setup. Removals made
 * elsewhere and plugins turned off elsewhere apply on their own, once per
 * plan; installing and turning a plugin on can ask for consent, so they wait
 * for the user and go through the plugin library like any other install.
 */
export function usePluginReconcile(plan: PluginPlan): PluginReconcile {
  const plugins = usePluginsOptional();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const ready = plugins?.initialLoadDone === true;
  const installed = plugins?.installed;
  const disabled = plugins?.disabled;
  const registry = plugins?.registry;
  const reconciliation = useMemo(() => {
    if (!ready || !installed || !disabled || !registry) return NOTHING;
    return reconcilePlugins(plan, installed, disabled, registry);
  }, [plan, ready, installed, disabled, registry]);

  // What has been started and is still asked for, so a re-render or a reread
  // plan mid-uninstall does not start it twice. An id leaves once no plan asks.
  const started = useRef(new Set<string>());
  const uninstall = plugins?.uninstall;
  const setEnabled = plugins?.setEnabled;
  useEffect(() => {
    if (!uninstall || !setEnabled) return;
    const asked = new Set([...reconciliation.removals, ...reconciliation.toDisable]);
    for (const id of started.current) {
      if (!asked.has(id)) started.current.delete(id);
    }
    for (const id of reconciliation.removals) {
      if (started.current.has(id)) continue;
      started.current.add(id);
      void uninstall(id);
    }
    for (const id of reconciliation.toDisable) {
      if (started.current.has(id)) continue;
      started.current.add(id);
      void setEnabled(id, false);
    }
  }, [reconciliation, uninstall, setEnabled]);

  const pending = useCallback(async (id: string, action: () => Promise<void>) => {
    setPendingId(id);
    try {
      await action();
    } finally {
      setPendingId(null);
    }
  }, []);

  const installFromRegistry = plugins?.installFromRegistry;
  const install = useCallback(
    async (id: string) => {
      const entry = reconciliation.missing.find((e) => e.id === id);
      if (!entry || !installFromRegistry) return;
      await pending(id, () => installFromRegistry(entry));
    },
    [reconciliation, installFromRegistry, pending],
  );

  const installAll = useCallback(async () => {
    if (!installFromRegistry) return;
    // One at a time: each install may open its own consent prompt.
    for (const entry of reconciliation.missing) {
      await pending(entry.id, () => installFromRegistry(entry));
    }
  }, [reconciliation, installFromRegistry, pending]);

  const enable = useCallback(
    async (id: string) => {
      if (!setEnabled) return;
      await pending(id, () => setEnabled(id, true));
    },
    [setEnabled, pending],
  );

  return { reconciliation, pendingId, install, installAll, enable };
}
