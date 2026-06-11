import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { createPluginHost, type LoadedPluginInfo, type PluginHost } from "@/lib/plugins/host";
import type { InstalledPlugin } from "@/lib/plugins/types";

const TOAST_DURATION_MS = 4000;

export interface PluginsContextValue {
  /** Contribution registries, for the palette and status bar to read. */
  commands: PluginHost["commands"];
  statusBarItems: PluginHost["statusBarItems"];
  /** Plugins currently loaded, for future manager UI. */
  loaded: LoadedPluginInfo[];
  /** Pick a plugin folder, install it into the app config dir, and load it. */
  installFromFolder: () => Promise<void>;
}

export const PluginsContext = createContext<PluginsContextValue | null>(null);

/**
 * Owns the plugin host for the app: loads every installed plugin on startup,
 * exposes the contribution registries, renders plugin toasts (`ctx.notify`),
 * and provides the install-from-folder flow used by the command palette.
 */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<PluginToast[]>([]);
  const [loaded, setLoaded] = useState<LoadedPluginInfo[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  // One host per provider; pushToast is stable so the closure stays valid.
  const [host] = useState(() => createPluginHost(pushToast));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<InstalledPlugin[]>("list_plugins");
        const plugins = Array.isArray(result) ? result : [];
        for (const plugin of plugins) {
          if (cancelled) return;
          try {
            await host.load(plugin);
          } catch (err) {
            console.error(`Failed to load plugin ${plugin.id}:`, err);
          }
        }
      } catch (err) {
        console.error("Failed to list installed plugins:", err);
      }
      if (!cancelled) setLoaded(host.listLoaded());
    })();
    return () => {
      cancelled = true;
      host.unloadAll();
    };
  }, [host]);

  const installFromFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false, title: "Select a plugin folder" });
    if (typeof dir !== "string") return; // cancelled
    try {
      const plugin = await invoke<InstalledPlugin>("install_plugin", { srcDir: dir });
      await host.load(plugin);
      setLoaded(host.listLoaded());
      pushToast(`Installed plugin: ${plugin.name} v${plugin.version}`);
    } catch (err) {
      console.error("Plugin install failed:", err);
      pushToast(`Plugin install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [host, pushToast]);

  return (
    <PluginsContext.Provider
      value={{
        commands: host.commands,
        statusBarItems: host.statusBarItems,
        loaded,
        installFromFolder,
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
