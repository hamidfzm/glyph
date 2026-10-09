import { type ReactNode, useCallback, useRef, useState } from "react";
import { PluginOverlay } from "@/components/plugins/PluginOverlay";
import { PluginStyles } from "@/components/plugins/PluginStyles";
import { type PluginToast, PluginToasts } from "@/components/plugins/PluginToasts";
import { PluginsContext } from "@/contexts/PluginsContext";
import { useCorePlugins } from "@/hooks/useCorePlugins";
import { usePluginLibrary } from "@/hooks/usePluginLibrary";
import { registerTranslations } from "@/lib/i18n";
import { pluginAppState } from "@/lib/plugins/appState";
import { createPluginHost } from "@/lib/plugins/host";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";

const TOAST_DURATION_MS = 4000;

/**
 * Owns the plugin host for the app: loads enabled plugins on startup, exposes
 * the contribution registries and the marketplace, renders plugin toasts
 * (`ctx.notify`), and provides the install / enable / uninstall actions the
 * Settings Plugins tab drives.
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

  // One host per provider; pushToast is stable so the closure stays valid.
  // The workspace root is mirrored from TabsContext by usePluginAppBridge
  // (this provider mounts above TabsProvider and cannot read it directly).
  const [host] = useState(() =>
    createPluginHost(pushToast, registerTranslations, () => pluginAppState().workspaceRoot, {
      load: loadPluginSettings,
      save: (id, settings) => void savePluginSettings(id, settings),
    }),
  );

  const coreReady = useCorePlugins(host, pushToast);
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
  } = usePluginLibrary({ host, pushToast, coreReady });

  return (
    <PluginsContext.Provider
      value={{
        commands: host.commands,
        statusBarItems: host.statusBarItems,
        remarkPlugins: host.remarkPlugins,
        rehypePlugins: host.rehypePlugins,
        fencedRenderers: host.fencedRenderers,
        sidebarPanels: host.sidebarPanels,
        fileTreeFilters: host.fileTreeFilters,
        settingsPanels: host.settingsPanels,
        workspaceSettingsPanels: host.workspaceSettingsPanels,
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
        initialLoadDone,
      }}
    >
      {children}
      <PluginStyles />
      <PluginToasts toasts={toasts} />
      <PluginOverlay />
    </PluginsContext.Provider>
  );
}
