import { vi } from "vitest";
import type { PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";

/** A PluginsContext value with empty registries and no plugins; override what the test needs. */
export function pluginsContextValue(
  overrides: Partial<PluginsContextValue> = {},
): PluginsContextValue {
  return {
    commands: createRegistry(),
    statusBarItems: createRegistry(),
    remarkPlugins: createRegistry(),
    rehypePlugins: createRegistry(),
    fencedRenderers: createRegistry(),
    sidebarPanels: createRegistry(),
    fileTreeFilters: createRegistry(),
    settingsPanels: createRegistry(),
    workspaceSettingsPanels: createRegistry(),
    styles: createRegistry(),
    exporters: createRegistry(),
    siteThemes: createRegistry(),
    installed: [],
    disabled: [],
    loaded: [],
    registry: [],
    updates: [],
    installFromFolder: vi.fn(async () => {}),
    installFromRegistry: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    initialLoadDone: true,
    ...overrides,
  };
}
