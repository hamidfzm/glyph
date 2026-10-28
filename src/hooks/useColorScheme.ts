import { useMemo } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import { readColorSchemeSetting, resolveColorScheme } from "@/lib/colorSchemeStatus";
import { uniqueColorSchemes } from "@/lib/plugins/colorSchemes";

/** The saved color scheme, what it resolves to, and the schemes plugins offer. */
export function useColorScheme() {
  const { settings } = useSettings();
  const plugins = usePluginsOptional();
  const entries = useRegistryEntries(plugins?.colorSchemes);
  const schemes = useMemo(() => uniqueColorSchemes(entries), [entries]);
  const saved = readColorSchemeSetting(settings.appearance.colorScheme);
  const status = resolveColorScheme({
    saved,
    schemes,
    // Without a plugin host nothing can load, and nothing is judged missing.
    initialLoadDone: plugins?.initialLoadDone ?? false,
    corePlugins: settings.corePlugins,
    installed: plugins?.installed ?? [],
    disabled: plugins?.disabled ?? [],
  });
  return { saved, status, schemes };
}
