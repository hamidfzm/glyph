import type { ReactNode } from "react";
import { vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { SettingsContext } from "@/contexts/SettingsContext";
import { colorSchemeEntry } from "@/lib/plugins/colorSchemes";
import { createRegistry } from "@/lib/plugins/registry";
import type { ColorSchemeEntry } from "@/lib/plugins/types";
import { type ColorSchemeSetting, type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { pluginsContextValue } from "@/test/fixtures/pluginsContext";

interface ColorSchemeHarnessOptions {
  /** The stored `appearance.colorScheme`, typed loosely: the store is not type-checked. */
  saved?: unknown;
  corePlugins?: Partial<CorePluginSettings>;
  plugins?: Partial<PluginsContextValue>;
}

/**
 * Settings and plugins contexts around the color scheme picker, its stylesheet,
 * and what follows them. `offer` registers a scheme the way a loaded plugin
 * does; `setSaved` changes the stored choice before the next rerender.
 */
export function colorSchemeHarness({
  saved,
  corePlugins,
  plugins,
}: ColorSchemeHarnessOptions = {}) {
  const colorSchemes = createRegistry<ColorSchemeEntry>();
  const updateSettings = vi.fn();
  let colorScheme: unknown = saved ?? DEFAULT_SETTINGS.appearance.colorScheme;
  const pluginsValue = pluginsContextValue({ colorSchemes, ...plugins });

  const wrapper = ({ children }: { children: ReactNode }) => {
    const settings = {
      ...DEFAULT_SETTINGS,
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        colorScheme: colorScheme as ColorSchemeSetting,
      },
      corePlugins: { ...DEFAULT_SETTINGS.corePlugins, ...corePlugins },
    };
    return (
      <SettingsContext.Provider
        value={{
          settings,
          updateSettings,
          resetSettings: vi.fn(),
          flushSettings: async () => true,
          loaded: true,
        }}
      >
        <PluginsContext.Provider value={pluginsValue}>{children}</PluginsContext.Provider>
      </SettingsContext.Provider>
    );
  };

  const offer = (pluginId: string, id: string, label = id, css = `:root{--scheme:${id}}`) =>
    colorSchemes.register(colorSchemeEntry(pluginId, { id, label, css }));
  const setSaved = (next: unknown) => {
    colorScheme = next;
  };
  return { wrapper, updateSettings, offer, setSaved };
}
