import { useEffect } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { matchesAccelerator, resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";

interface UseTabReorderShortcutsOptions {
  platform: Platform;
  /** Move the active tab by one position: -1 left, +1 right. */
  onMove: (delta: -1 | 1) => void;
}

// Global keyboard shortcuts for reordering the active tab within the tab strip
// (move-tab-left / move-tab-right, remappable in Settings → Hotkeys). Works
// regardless of focus: unlike undo/redo there is no editor-local equivalent to
// defer to, so moving a tab while typing is the intended behavior.
export function useTabReorderShortcuts({ platform, onMove }: UseTabReorderShortcutsOptions) {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;

  useEffect(() => {
    const resolved = resolveBindings(overrides);
    const leftAccel = resolved.get("move-tab-left");
    const rightAccel = resolved.get("move-tab-right");

    const handleKeyDown = (event: KeyboardEvent) => {
      const isLeft = !!leftAccel && matchesAccelerator(event, leftAccel, platform);
      const isRight = !isLeft && !!rightAccel && matchesAccelerator(event, rightAccel, platform);
      if (!isLeft && !isRight) return;
      event.preventDefault();
      onMove(isLeft ? -1 : 1);
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
  }, [platform, onMove, overrides]);
}
