import { useEffect, useRef } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { matchesAccelerator } from "@/lib/accelerator";
import { resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";

// Document-level keydown dispatcher for in-app commands (`nativeMenu: false` in
// BINDABLE_COMMANDS): `handlers` maps a command id to its action, and each key
// resolves through the user's bindings (Settings → Hotkeys). Runs regardless of
// focus; callers that must defer to the editor add their own guard.
export function useBoundShortcuts(platform: Platform, handlers: Record<string, () => void>) {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;
  // Callers pass a fresh object each render; only the id set needs to re-bind.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ids = Object.keys(handlers).join(" ");

  useEffect(() => {
    const resolved = resolveBindings(overrides);
    const bindings = ids.split(" ").flatMap((id) => {
      const accelerator = resolved.get(id);
      return accelerator ? [[id, accelerator] as const] : [];
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const [id, accelerator] of bindings) {
        if (!matchesAccelerator(event, accelerator, platform)) continue;
        event.preventDefault();
        handlersRef.current[id]();
        return;
      }
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
  }, [platform, overrides, ids]);
}
