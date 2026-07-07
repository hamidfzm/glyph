import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginStyles } from "@/components/plugins/PluginStyles";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { PluginsContext } from "@/contexts/PluginsContext";
import { registerTranslations } from "@/lib/i18n";
import { loadDisabled, saveDisabled } from "@/lib/plugins/disabledStore";
import { createPluginHost, type LoadedPluginInfo } from "@/lib/plugins/host";
import {
  installFromRegistry as downloadAndInstall,
  fetchRegistry,
  findUpdates,
  type RegistryEntry,
} from "@/lib/plugins/marketplace";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";
import type { InstalledPlugin } from "@/lib/plugins/types";

const TOAST_DURATION_MS = 4000;

/**
 * Owns the plugin host for the app: loads enabled plugins on startup, exposes
 * the contribution registries and the marketplace, renders plugin toasts
 * (`ctx.notify`), and provides the install / enable / uninstall actions the
 * management modal drives.
 */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("plugins");
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

  // Native yes/no consent before any code is installed. Installing implies
  // consent, so re-enabling an already-installed plugin never re-prompts.
  const confirmInstall = useCallback(
    (name: string, permissions?: string[]) => {
      const requests = permissions?.length
        ? `\n\n${t("consentPermissions")}\n${permissions.map((p) => `- ${p}`).join("\n")}`
        : "";
      return ask(`${t("consentBody", { name })}${requests}`, {
        title: t("consentTitle"),
        kind: "warning",
      });
    },
    [t],
  );

  const installFromFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false, title: "Select a plugin folder" });
    if (typeof dir !== "string") return; // cancelled
    // Folder installs read the manifest during install, so consent names the
    // folder; declared permissions still show afterwards in Manage Plugins.
    if (!(await confirmInstall(dir))) return;
    try {
      const plugin = await invoke<InstalledPlugin>("install_plugin", { srcDir: dir });
      await host.load(plugin);
      afterInstall(plugin);
    } catch (err) {
      reportFailure(err);
    }
  }, [host, afterInstall, reportFailure, confirmInstall]);

  const installFromRegistry = useCallback(
    async (entry: RegistryEntry) => {
      if (!(await confirmInstall(entry.name, entry.permissions))) return;
      try {
        const plugin = await downloadAndInstall(entry);
        await host.load(plugin);
        afterInstall(plugin);
      } catch (err) {
        reportFailure(err);
      }
    },
    [host, afterInstall, reportFailure, confirmInstall],
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
        persistDisabled((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : prev));
      } else {
        host.unload(id);
        persistDisabled((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
      setLoaded(host.listLoaded());
    },
    [installed, host, reportFailure, persistDisabled],
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
      setLoaded(host.listLoaded());
    },
    [host, reportFailure, persistDisabled],
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
      }}
    >
      {children}
      <PluginStyles />
      <PluginToasts toasts={toasts} />
    </PluginsContext.Provider>
  );
}
