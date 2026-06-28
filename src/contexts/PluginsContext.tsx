import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { registerTranslations } from "@/lib/i18n";
import { loadDisabled, saveDisabled } from "@/lib/plugins/disabledStore";
import { createPluginHost, type LoadedPluginInfo, type PluginHost } from "@/lib/plugins/host";
import {
  installFromRegistry as downloadAndInstall,
  fetchRegistry,
  findUpdates,
  type RegistryEntry,
  type RegistryUpdate,
} from "@/lib/plugins/marketplace";
import type { InstalledPlugin } from "@/lib/plugins/types";

const TOAST_DURATION_MS = 4000;

export interface PluginsContextValue {
  /** Contribution registries, for the palette and status bar to read. */
  commands: PluginHost["commands"];
  statusBarItems: PluginHost["statusBarItems"];
  /** Every plugin on disk, enabled or not. */
  installed: InstalledPlugin[];
  /** Ids the user has deactivated (installed but not loaded). */
  disabled: string[];
  /** Plugins currently active in the host. */
  loaded: LoadedPluginInfo[];
  /** Marketplace entries from the glyph-md registry (empty if unreachable). */
  registry: RegistryEntry[];
  /** Installed plugins with a newer version available in the registry. */
  updates: RegistryUpdate[];
  /** Pick a plugin folder, install it into the app config dir, and load it. */
  installFromFolder: () => Promise<void>;
  /** Download and install (or update) a marketplace entry, then load it. */
  installFromRegistry: (entry: RegistryEntry) => Promise<void>;
  /** Activate or deactivate an installed plugin (persisted across restarts). */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Unload and delete an installed plugin from disk. */
  uninstall: (id: string) => Promise<void>;
}

export const PluginsContext = createContext<PluginsContextValue | null>(null);

/**
 * Owns the plugin host for the app: loads enabled plugins on startup, exposes
 * the contribution registries and the marketplace, renders plugin toasts
 * (`ctx.notify`), and provides the install / enable / uninstall actions the
 * management modal drives.
 */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<PluginToast[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
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

  // One host per provider; pushToast is stable so the closure stays valid.
  const [host] = useState(() => createPluginHost(pushToast, registerTranslations));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dis = await loadDisabled();
      let all: InstalledPlugin[] = [];
      try {
        const result = await invoke<InstalledPlugin[]>("list_plugins");
        all = Array.isArray(result) ? result : [];
      } catch (err) {
        console.error("Failed to list installed plugins:", err);
      }
      for (const plugin of all) {
        if (cancelled) return;
        if (dis.includes(plugin.id)) continue; // deactivated: on disk, not loaded
        try {
          await host.load(plugin);
        } catch (err) {
          console.error(`Failed to load plugin ${plugin.id}:`, err);
        }
      }
      if (!cancelled) {
        setInstalled(all);
        setDisabled(dis);
        setLoaded(host.listLoaded());
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
  }, [host]);

  const updates = useMemo(() => findUpdates(installed, registry), [installed, registry]);

  // Record a freshly installed/updated plugin: on disk, enabled, and loaded.
  const afterInstall = useCallback(
    (plugin: InstalledPlugin) => {
      setInstalled((prev) => [...prev.filter((p) => p.id !== plugin.id), plugin]);
      setDisabled((prev) => {
        if (!prev.includes(plugin.id)) return prev;
        const next = prev.filter((d) => d !== plugin.id);
        void saveDisabled(next);
        return next;
      });
      setLoaded(host.listLoaded());
      pushToast(`Installed plugin: ${plugin.name} v${plugin.version}`);
    },
    [host, pushToast],
  );

  const reportFailure = useCallback(
    (err: unknown) => {
      console.error("Plugin operation failed:", err);
      pushToast(`Plugin error: ${err instanceof Error ? err.message : String(err)}`);
    },
    [pushToast],
  );

  const installFromFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false, title: "Select a plugin folder" });
    if (typeof dir !== "string") return; // cancelled
    try {
      const plugin = await invoke<InstalledPlugin>("install_plugin", { srcDir: dir });
      await host.load(plugin);
      afterInstall(plugin);
    } catch (err) {
      reportFailure(err);
    }
  }, [host, afterInstall, reportFailure]);

  const installFromRegistry = useCallback(
    async (entry: RegistryEntry) => {
      try {
        const plugin = await downloadAndInstall(entry);
        await host.load(plugin);
        afterInstall(plugin);
      } catch (err) {
        reportFailure(err);
      }
    },
    [host, afterInstall, reportFailure],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (enabled) {
        const plugin = installed.find((p) => p.id === id);
        if (!plugin) return;
        try {
          await host.load(plugin);
        } catch (err) {
          reportFailure(err);
          return;
        }
        const next = disabled.filter((d) => d !== id);
        setDisabled(next);
        await saveDisabled(next);
      } else {
        host.unload(id);
        const next = disabled.includes(id) ? disabled : [...disabled, id];
        setDisabled(next);
        await saveDisabled(next);
      }
      setLoaded(host.listLoaded());
    },
    [installed, disabled, host, reportFailure],
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
      const next = disabled.filter((d) => d !== id);
      setDisabled(next);
      await saveDisabled(next);
      setLoaded(host.listLoaded());
    },
    [disabled, host, reportFailure],
  );

  return (
    <PluginsContext.Provider
      value={{
        commands: host.commands,
        statusBarItems: host.statusBarItems,
        installed,
        disabled,
        loaded,
        registry,
        updates,
        installFromFolder,
        installFromRegistry,
        setEnabled,
        uninstall,
      }}
    >
      {children}
      <PluginToasts toasts={toasts} />
    </PluginsContext.Provider>
  );
}

/**
 * Optional accessor: returns `null` when no provider is mounted. Plugin
 * integration points (palette, status bar) use this so they keep working in
 * isolation: component tests and storybook-style rendering don't need the
 * provider.
 */
export function usePluginsOptional(): PluginsContextValue | null {
  return useContext(PluginsContext);
}
