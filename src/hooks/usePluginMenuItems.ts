import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { isMobilePlatform } from "@/lib/platform";
import type { ExporterContribution } from "@/lib/plugins/types";
import { subscribe } from "@/lib/tauriEvent";

interface PluginMenuItemEvent {
  menu: "export" | "view";
  index: number;
}

/**
 * List plugin exporters under File > Export and `menu: "view"` plugin
 * commands under View in the native menu, and run them when picked.
 */
export function usePluginMenuItems(
  runPluginExporter: (exporter: ExporterContribution) => void,
): void {
  const plugins = usePluginsOptional();
  const exporters = useRegistryEntries(plugins?.exporters ?? null);
  const commands = useRegistryEntries(plugins?.commands ?? null);
  const viewCommands = useMemo(
    () => commands.filter((command) => command.menu === "view"),
    [commands],
  );

  useEffect(() => {
    // No native menu (or set_plugin_menu_items command) exists on mobile.
    if (isMobilePlatform()) return;
    invoke("set_plugin_menu_items", {
      export: exporters.map((exporter) => `${exporter.label}\u2026`),
      view: viewCommands.map((command) => command.title),
    }).catch((err) => console.error("Failed to list plugin menu items:", err));
  }, [exporters, viewCommands]);

  useEffect(
    () =>
      subscribe<PluginMenuItemEvent>("menu-plugin-item", ({ payload }) => {
        if (payload.menu === "export") {
          const exporter = exporters[payload.index];
          if (exporter) runPluginExporter(exporter);
          return;
        }
        void viewCommands[payload.index]?.run();
      }),
    [exporters, viewCommands, runPluginExporter],
  );
}
