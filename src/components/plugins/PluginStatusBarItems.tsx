import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { PluginMountSlot } from "./PluginMountSlot";

/**
 * Status bar items contributed by plugins. Renders nothing when no plugins are
 * loaded or no PluginsProvider is mounted, so the status bar's layout is
 * untouched in the common case.
 */
export function PluginStatusBarItems() {
  const plugins = usePluginsOptional();
  const items = useRegistryEntries(plugins?.statusBarItems ?? null);

  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <PluginMountSlot key={item.id} contribution={item} />
      ))}
    </>
  );
}
