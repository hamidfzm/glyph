import { useEffect } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import type { Platform } from "@/hooks/usePlatform";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import { matchesAccelerator } from "@/lib/accelerator";
import { resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";
import {
  isCommandAvailable,
  isMenuCommand,
  pluginBindableCommands,
  pluginBindingId,
} from "@/lib/plugins/commandBindings";

// macOS and GTK deliver a native menu item's accelerator themselves; handling
// it here as well would run the command twice (see useMenuShortcuts).
function deliversMenuAccelerators(platform: Platform): boolean {
  return platform === "macos" || platform === "linux";
}

/**
 * Runs plugin commands from their keyboard shortcuts, resolved through the
 * user's bindings (Settings, Hotkeys). A command listed in a native menu is
 * left to the menu where the platform delivers its accelerator.
 */
export function usePluginCommandShortcuts(platform: Platform): void {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;
  const plugins = usePluginsOptional();
  const commands = useRegistryEntries(plugins?.commands ?? null);
  const workspaceOpen = useWorkspaceRoot() !== undefined;

  useEffect(() => {
    const resolved = resolveBindings(overrides, pluginBindableCommands(commands));
    const bindings = commands.flatMap((command) => {
      const accelerator = resolved.get(pluginBindingId(command));
      const menuDelivers = isMenuCommand(command) && deliversMenuAccelerators(platform);
      if (!accelerator || menuDelivers) return [];
      return [{ accelerator, command }];
    });
    if (bindings.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const bound = bindings.find(({ accelerator }) =>
        matchesAccelerator(event, accelerator, platform),
      );
      if (!bound || !isCommandAvailable(bound.command, workspaceOpen)) return;
      event.preventDefault();
      void bound.command.run();
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
  }, [platform, overrides, commands, workspaceOpen]);
}
