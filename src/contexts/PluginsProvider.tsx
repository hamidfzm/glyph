import { invoke } from "@tauri-apps/api/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PluginStyles } from "@/components/plugins/PluginStyles";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { PluginsContext } from "@/contexts/PluginsContext";
import { usePluginConsent } from "@/hooks/usePluginConsent";
import { registerTranslations } from "@/lib/i18n";
import { pickPluginDir } from "@/lib/pickers";
import { loadDisabled, saveDisabled } from "@/lib/plugins/disabledStore";
import { createPluginHost, type LoadedPluginInfo } from "@/lib/plugins/host";
import {
  installFromRegistry as downloadAndInstall,
  fetchRegistry,
  findUpdates,
  type RegistryEntry,
} from "@/lib/plugins/marketplace";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";
import type { InstalledPlugin, PluginInspection } from "@/lib/plugins/types";

const TOAST_DURATION_MS = 4000;

/**
 * Owns the plugin host for the app: loads enabled plugins on startup, exposes
 * the contribution registries and the marketplace, renders plugin toasts
 * (`ctx.notify`), and provides the install / enable / uninstall actions the
 * management modal drives.
 */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const { hydrateGrants, hasFullTrust, ensureConsent, revokeGrant } = usePluginConsent();
  const [toasts, setToasts] = useState<PluginToast[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<LoadedPluginInfo[]>([]);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  // The opened workspace root, mirrored from TabsContext by
  // usePluginWorkspaceSync (this provider mounts above TabsProvider, so it
  // cannot read that context directly). A ref, not state: only ctx.workspace
  // calls read it, and they always want the current value.
  const workspaceRootRef = useRef<string | null>(null);
  const setWorkspaceRoot = useCallback((root: string | null) => {
    workspaceRootRef.current = root;
  }, []);

  // One host per provider; pushToast is stable so the closure stays valid.
  const [host] = useState(() =>
    createPluginHost(pushToast, registerTranslations, () => workspaceRootRef.current, {
      load: loadPluginSettings,
      save: (id, settings) => void savePluginSettings(id, settings),
    }),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dis] = await Promise.all([loadDisabled(), hydrateGrants()]);
      let all: InstalledPlugin[] = [];
      try {
        const result = await invoke<InstalledPlugin[]>("list_plugins");
        all = Array.isArray(result) ? result : [];
      } catch (err) {
        console.error("Failed to list installed plugins:", err);
      }
      // Full-trust plugins never run on an implicit grant: without one they
      // land in the disabled list, and re-enabling routes through the warning.
      const ungranted = all
        .filter((p) => !p.sandbox && !dis.includes(p.id) && !hasFullTrust(p.id))
        .map((p) => p.id);
      const nextDisabled = [...dis, ...ungranted];
      for (const plugin of all) {
        if (cancelled) return;
        if (nextDisabled.includes(plugin.id)) continue; // deactivated: on disk, not loaded
        try {
          await host.load(plugin);
        } catch (err) {
          console.error(`Failed to load plugin ${plugin.id}:`, err);
        }
      }
      if (!cancelled) {
        if (ungranted.length > 0) void saveDisabled(nextDisabled);
        setInstalled(all);
        setDisabled(nextDisabled);
        setLoaded(host.listLoaded());
        setInitialLoadDone(true);
      }
    })();
    // Marketplace index is best-effort: offline just means no available/updates.
    fetchRegistry()
      .then((entries) => {
        if (!cancelled) setRegistry(entries);
      })
      .catch((err) => console.error("Failed to fetch plugin registry:", err));
    return () => {
      cancelled = true;
      host.unloadAll();
    };
  }, [host, hydrateGrants, hasFullTrust]);

  const updates = useMemo(() => findUpdates(installed, registry), [installed, registry]);

  // Functional updates throughout: concurrent operations would otherwise close
  // over the same stale `disabled` array and clobber each other's persisted
  // change. Persisting inside the updater keeps state and store in lockstep.
  const persistDisabled = useCallback((update: (prev: string[]) => string[]) => {
    setDisabled((prev) => {
      const next = update(prev);
      if (next !== prev) void saveDisabled(next);
      return next;
    });
  }, []);

  // Record a freshly installed/updated plugin: on disk, enabled, and loaded.
  const afterInstall = useCallback(
    (plugin: InstalledPlugin) => {
      setInstalled((prev) => [...prev.filter((p) => p.id !== plugin.id), plugin]);
      persistDisabled((prev) =>
        prev.includes(plugin.id) ? prev.filter((d) => d !== plugin.id) : prev,
      );
      setLoaded(host.listLoaded());
      pushToast(`Installed plugin: ${plugin.name} v${plugin.version}`);
    },
    [host, pushToast, persistDisabled],
  );

  const reportFailure = useCallback(
    (err: unknown) => {
      console.error("Plugin operation failed:", err);
      pushToast(`Plugin error: ${err instanceof Error ? err.message : String(err)}`);
    },
    [pushToast],
  );

  // Consent for what actually landed on disk, which may differ from what the
  // pre-install prompt described (a package manifest demanding more than the
  // registry advertised, or the pending picked folder changing between
  // inspect_plugin and install_plugin). A covered grant makes this a no-op;
  // a refusal uninstalls the plugin again.
  const consentInstalledOrRollBack = useCallback(
    async (plugin: InstalledPlugin) => {
      if (await ensureConsent(plugin)) return true;
      await invoke("uninstall_plugin", { id: plugin.id });
      return false;
    },
    [ensureConsent],
  );

  const installFromFolder = useCallback(async () => {
    // The backend picker stashes the folder; inspect_plugin peeks it and
    // install_plugin consumes it, so consent shows the manifest's identity,
    // trust mode, and permissions before any code is copied.
    const dir = await pickPluginDir();
    if (typeof dir !== "string") return; // cancelled
    try {
      const inspection = await invoke<PluginInspection>("inspect_plugin");
      if (!(await ensureConsent(inspection))) return;
      const plugin = await invoke<InstalledPlugin>("install_plugin");
      if (!(await consentInstalledOrRollBack(plugin))) return;
      await host.load(plugin);
      afterInstall(plugin);
    } catch (err) {
      reportFailure(err);
    }
  }, [host, afterInstall, reportFailure, ensureConsent, consentInstalledOrRollBack]);

  const installFromRegistry = useCallback(
    async (entry: RegistryEntry) => {
      try {
        const advertised = {
          id: entry.id,
          name: entry.name,
          sandbox: entry.sandbox !== false,
          permissions: entry.permissions,
        };
        if (!(await ensureConsent(advertised))) return;
        const plugin = await downloadAndInstall(entry);
        if (!(await consentInstalledOrRollBack(plugin))) return;
        await host.load(plugin);
        afterInstall(plugin);
      } catch (err) {
        reportFailure(err);
      }
    },
    [host, afterInstall, reportFailure, ensureConsent, consentInstalledOrRollBack],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (enabled) {
        const plugin = installed.find((p) => p.id === id);
        if (!plugin) return;
        // Covers legacy full-trust plugins parked disabled at startup: the
        // warning runs here and the grant persists on acceptance.
        if (!(await ensureConsent(plugin))) return;
        try {
          await host.load(plugin);
        } catch (err) {
          reportFailure(err);
          return;
        }
        persistDisabled((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : prev));
      } else {
        host.unload(id);
        persistDisabled((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
      setLoaded(host.listLoaded());
    },
    [installed, host, reportFailure, persistDisabled, ensureConsent],
  );

  const uninstall = useCallback(
    async (id: string) => {
      host.unload(id);
      try {
        await invoke("uninstall_plugin", { id });
      } catch (err) {
        reportFailure(err);
        return;
      }
      setInstalled((prev) => prev.filter((p) => p.id !== id));
      persistDisabled((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : prev));
      revokeGrant(id);
      setLoaded(host.listLoaded());
    },
    [host, reportFailure, persistDisabled, revokeGrant],
  );

  return (
    <PluginsContext.Provider
      value={{
        commands: host.commands,
        statusBarItems: host.statusBarItems,
        remarkPlugins: host.remarkPlugins,
        rehypePlugins: host.rehypePlugins,
        fencedRenderers: host.fencedRenderers,
        sidebarPanels: host.sidebarPanels,
        settingsPanels: host.settingsPanels,
        styles: host.styles,
        exporters: host.exporters,
        siteThemes: host.siteThemes,
        installed,
        disabled,
        loaded,
        registry,
        updates,
        installFromFolder,
        installFromRegistry,
        setEnabled,
        uninstall,
        setWorkspaceRoot,
        initialLoadDone,
      }}
    >
      {children}
      <PluginStyles />
      <PluginToasts toasts={toasts} />
    </PluginsContext.Provider>
  );
}
