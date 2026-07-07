import { createContext, useContext } from "react";
import type { LoadedPluginInfo, PluginHost } from "@/lib/plugins/host";
import type { RegistryEntry, RegistryUpdate } from "@/lib/plugins/marketplace";
import type { InstalledPlugin } from "@/lib/plugins/types";

export interface PluginsContextValue {
  /** Contribution registries, for the palette, status bar, and renderer to read. */
  commands: PluginHost["commands"];
  statusBarItems: PluginHost["statusBarItems"];
  remarkPlugins: PluginHost["remarkPlugins"];
  rehypePlugins: PluginHost["rehypePlugins"];
  fencedRenderers: PluginHost["fencedRenderers"];
  sidebarPanels: PluginHost["sidebarPanels"];
  settingsPanels: PluginHost["settingsPanels"];
  styles: PluginHost["styles"];
  exporters: PluginHost["exporters"];
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
  /** Mirror the opened workspace root into the host (for ctx.workspace). */
  setWorkspaceRoot: (root: string | null) => void;
}

export const PluginsContext = createContext<PluginsContextValue | null>(null);

/**
 * Optional accessor: returns `null` when no provider is mounted. Plugin
 * integration points (palette, status bar) use this so they keep working in
 * isolation: component tests and storybook-style rendering don't need the
 * provider.
 */
export function usePluginsOptional(): PluginsContextValue | null {
  return useContext(PluginsContext);
}
