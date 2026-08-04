import { type ReactNode, useCallback, useRef, useState } from "react";
import { PluginStyles } from "@/components/plugins/PluginStyles";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { PluginsContext } from "@/contexts/PluginsContext";
import { usePluginLibrary } from "@/hooks/usePluginLibrary";
import { registerTranslations } from "@/lib/i18n";
import { createPluginHost } from "@/lib/plugins/host";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";

const TOAST_DURATION_MS = 4000;

/**
 * Owns the plugin host for the app: loads enabled plugins on startup, exposes
 * the contribution registries and the marketplace, renders plugin toasts
 * (`ctx.notify`), and provides the install / enable / uninstall actions the
 * management modal drives.
 */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<PluginToast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((message: string, tone?: "error") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
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

  const {
    installed,
    disabled,
    loaded,
    registry,
    updates,
    initialLoadDone,
    installFromFolder,
    installFromRegistry,
    setEnabled,
    uninstall,
  } = usePluginLibrary({ host, pushToast });

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
