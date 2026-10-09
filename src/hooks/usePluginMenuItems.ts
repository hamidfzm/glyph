import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import { resolveBindings } from "@/lib/keybindings";
import { isMobilePlatform } from "@/lib/platform";
import {
  isCommandAvailable,
  isMenuCommand,
  pluginBindableCommands,
  pluginBindingId,
} from "@/lib/plugins/commandBindings";
import { contributionKey } from "@/lib/plugins/contributionKey";
import type { ExporterContribution } from "@/lib/plugins/types";
import { subscribe } from "@/lib/tauriEvent";

interface PluginMenuItemEvent {
  menu: "export" | "file" | "view";
  key: string;
}

/**
 * List plugin exporters under File > Export and plugin commands under File or
 * View (as their `menu` names) in the native menu, and run them when picked.
 * Items are keyed by plugin and contribution id, not position: a menu that lags
 * the registries (a refused entry, another window's list on a shared app menu)
 * can then only run the contribution it names, or nothing.
 */
export function usePluginMenuItems(
  runPluginExporter: (exporter: ExporterContribution) => void,
): void {
  const { t } = useTranslation("commands");
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;
  const plugins = usePluginsOptional();
  const workspaceOpen = useWorkspaceRoot() !== undefined;
  const exporters = useRegistryEntries(plugins?.exporters ?? null);
  const commands = useRegistryEntries(plugins?.commands ?? null);
  const menuCommands = useMemo(() => commands.filter(isMenuCommand), [commands]);

  useEffect(() => {
    // No native menu (or set_plugin_menu_items command) exists on mobile.
    if (isMobilePlatform()) return;
    const resolved = resolveBindings(overrides, pluginBindableCommands(menuCommands));
    const entriesFor = (menu: "file" | "view") =>
      menuCommands
        .filter((command) => command.menu === menu)
        .map((command) => ({
          key: contributionKey(command),
          label: command.title,
          accelerator: resolved.get(pluginBindingId(command)) ?? null,
          requiresWorkspace: command.when === "workspace",
        }));
    invoke<number>("set_plugin_menu_items", {
      export: exporters.map((exporter) => ({
        key: contributionKey(exporter),
        label: t("exportMenuItem", { label: exporter.label }),
      })),
      view: entriesFor("view"),
      file: entriesFor("file"),
    })
      .then((refused) => {
        if (refused > 0) console.error(`${refused} plugin menu entries were refused`);
      })
      .catch((err) => console.error("Failed to list plugin menu items:", err));
  }, [exporters, menuCommands, overrides, t]);

  useEffect(
    () =>
      subscribe<PluginMenuItemEvent>("menu-plugin-item", ({ payload }) => {
        if (payload.menu === "export") {
          const exporter = exporters.find((entry) => contributionKey(entry) === payload.key);
          if (exporter) runPluginExporter(exporter);
          return;
        }
        const command = menuCommands.find(
          (entry) => entry.menu === payload.menu && contributionKey(entry) === payload.key,
        );
        if (command && isCommandAvailable(command, workspaceOpen)) void command.run();
      }),
    [exporters, menuCommands, workspaceOpen, runPluginExporter],
  );
}
