import { useEffect } from "react";
import { type MenuEventHandlers, menuEventActions } from "@/hooks/useMenuEvents";
import type { Platform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { BINDABLE_COMMANDS, matchesAccelerator, resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";

interface UseMenuShortcutsOptions {
  platform: Platform;
  /** The same handler object passed to `useMenuEvents`. */
  handlers: MenuEventHandlers;
}

// Commands whose accelerator is already served by a dedicated document
// listener; running them here as well would fire the action twice.
const HANDLED_ELSEWHERE = new Set(["open-command-palette"]);

/**
 * Keyboard fallback for the native menu accelerators.
 *
 * On Windows the WebView2 child window consumes key combinations before the
 * native menu sees them, so every command whose only trigger is a menu
 * accelerator (Open, Save, Find, Print, zoom, ...) does nothing, while the menu
 * item still works when clicked. Commands registered with `nativeMenu: false`
 * already have their own listeners and are skipped, as is anything in
 * HANDLED_ELSEWHERE.
 *
 * macOS delivers menu accelerators reliably, so the fallback stays off there to
 * avoid running an action twice.
 */
export function useMenuShortcuts({ platform, handlers }: UseMenuShortcutsOptions) {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;

  useEffect(() => {
    if (platform !== "windows") return;
    const resolved = resolveBindings(overrides);
    const actions = menuEventActions(handlers);
    const bindings = BINDABLE_COMMANDS.flatMap((command) => {
      if (!command.nativeMenu || !command.event || HANDLED_ELSEWHERE.has(command.id)) return [];
      const run = actions[command.event];
      const accelerator = resolved.get(command.id);
      if (!run || !accelerator) return [];
      return [[accelerator, run] as const];
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const [accelerator, run] of bindings) {
        if (!matchesAccelerator(event, accelerator, platform)) continue;
        event.preventDefault();
        run();
        return;
      }
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
  }, [platform, handlers, overrides]);
}
