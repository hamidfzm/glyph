import { parseAccelerator } from "@/lib/accelerator";
import type { BindableCommand } from "@/lib/bindableCommands";
import { contributionKey } from "./contributionKey";
import type { CommandContribution, CommandEntry } from "./types";

// A command's `menu`, `shortcut`, and `when` come from plugin code (and, for a
// sandboxed plugin, from its worker), so each is checked here before use.

/** The id a plugin command's shortcut is stored and rebound under. */
export function pluginBindingId(command: CommandEntry): string {
  return `plugin:${contributionKey(command)}`;
}

/** The command's default shortcut, or null when it has none the app can parse. */
function defaultShortcut(command: CommandContribution): string | null {
  const shortcut: unknown = command.shortcut;
  if (typeof shortcut !== "string" || !parseAccelerator(shortcut)) return null;
  return shortcut;
}

export function isMenuCommand(command: CommandContribution): boolean {
  return command.menu === "file" || command.menu === "view";
}

/** Plugin commands with a default shortcut, as the rows Settings, Hotkeys lists and rebinds. */
export function pluginBindableCommands(commands: readonly CommandEntry[]): BindableCommand[] {
  return commands.flatMap((command) => {
    const shortcut = defaultShortcut(command);
    if (!shortcut) return [];
    return [
      {
        id: pluginBindingId(command),
        label: command.title,
        category: "Plugins",
        defaultAccelerator: shortcut,
        nativeMenu: isMenuCommand(command),
      },
    ];
  });
}

/** Whether a plugin command's `when` condition holds. */
export function isCommandAvailable(command: CommandContribution, workspaceOpen: boolean): boolean {
  return command.when !== "workspace" || workspaceOpen;
}

/** The command's default shortcut as the palette spells one: "Cmd/Ctrl+Shift+T". */
export function paletteShortcut(command: CommandContribution): string | undefined {
  return defaultShortcut(command)?.replace("CmdOrCtrl", "Cmd/Ctrl");
}
