import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { PluginMountSlot } from "./PluginMountSlot";

/**
 * Titled sidebar sections contributed by plugins, rendered below the built-in
 * Outline section. Renders nothing when no plugins contribute panels or no
 * PluginsProvider is mounted, so the sidebar layout is untouched by default.
 */
export function PluginSidebarPanels() {
  const plugins = usePluginsOptional();
  const panels = useRegistryEntries(plugins?.sidebarPanels ?? null);

  if (panels.length === 0) return null;
  return (
    <>
      {panels.map((panel) => (
        <div key={panel.id} className="mt-4 pt-3 border-t border-[var(--color-border)]">
          <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            {panel.title}
          </h3>
          <PluginMountSlot contribution={panel} />
        </div>
      ))}
    </>
  );
}
