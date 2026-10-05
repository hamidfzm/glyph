import { useMemo } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { filesBlockKey, filesPanelBlocks } from "@/lib/plugins/filesBlocks";
import { PluginFilesBlock } from "./PluginFilesBlock";

/**
 * Plugin panels placed in the Files panel, below the tree. Renders nothing
 * when no plugin contributes one or no PluginsProvider is mounted.
 */
export function PluginFilesBlocks() {
  const plugins = usePluginsOptional();
  const panels = useRegistryEntries(plugins?.sidebarPanels ?? null);
  const blocks = useMemo(() => filesPanelBlocks(panels), [panels]);

  return (
    <>
      {blocks.map((panel) => (
        <PluginFilesBlock key={filesBlockKey(panel)} panel={panel} />
      ))}
    </>
  );
}
