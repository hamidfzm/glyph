import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { isMobilePlatform } from "@/lib/platform";
import type { ExporterContribution } from "@/lib/plugins/types";
import { subscribe } from "@/lib/tauriEvent";

interface PluginMenuItemEvent {
  menu: "export" | "view";
  key: string;
}

/**
 * List plugin exporters under File > Export and `menu: "view"` plugin
 * commands under View in the native menu, and run them when picked. Items are
 * keyed by contribution id, not position: a menu that lags the registries (a
 * refused entry, another window's list on a shared app menu) can then only
 * run the contribution it names, or nothing.
 */
export function usePluginMenuItems(
  runPluginExporter: (exporter: ExporterContribution) => void,
): void {
  const { t } = useTranslation("commands");
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
    invoke<number>("set_plugin_menu_items", {
      export: exporters.map((exporter) => ({
        key: exporter.id,
        label: t("exportMenuItem", { label: exporter.label }),
      })),
      view: viewCommands.map((command) => ({ key: command.id, label: command.title })),
    })
      .then((refused) => {
        if (refused > 0) console.error(`${refused} plugin menu entries were refused`);
      })
      .catch((err) => console.error("Failed to list plugin menu items:", err));
  }, [exporters, viewCommands, t]);

  useEffect(
    () =>
      subscribe<PluginMenuItemEvent>("menu-plugin-item", ({ payload }) => {
        if (payload.menu === "export") {
          const exporter = exporters.find((entry) => entry.id === payload.key);
          if (exporter) runPluginExporter(exporter);
          return;
        }
        void viewCommands.find((command) => command.id === payload.key)?.run();
      }),
    [exporters, viewCommands, runPluginExporter],
  );
}
