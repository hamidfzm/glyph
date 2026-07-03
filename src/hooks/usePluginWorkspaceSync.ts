import { useEffect } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";

/**
 * Mirror the opened workspace root into the plugin host so `ctx.workspace`
 * stays scoped to it. Needed because PluginsProvider mounts above TabsProvider
 * and cannot read the tabs context itself. No-op without a PluginsProvider.
 */
export function usePluginWorkspaceSync(): void {
  const plugins = usePluginsOptional();
  const root = useWorkspaceRoot();

  useEffect(() => {
    plugins?.setWorkspaceRoot(root ?? null);
  }, [plugins, root]);
}
