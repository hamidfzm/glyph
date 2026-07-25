import { useEffect } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { matchesAccelerator, resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";

interface UseZoomShortcutsOptions {
  platform: Platform;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

// Global keyboard shortcuts for the zoom commands (remappable in Settings →
// Hotkeys). The native menu carries the same accelerators, but on Windows the
// WebView2 child window consumes Ctrl+= / Ctrl+- / Ctrl+0 before the menu ever
// sees them, so the menu item works by click while the key does nothing. Every
// other shortcut that survives (palette, undo/redo, tab reorder) does so via a
// document listener like this one.
export function useZoomShortcuts({
  platform,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: UseZoomShortcutsOptions) {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;

  useEffect(() => {
    const resolved = resolveBindings(overrides);
    const actions: [string | undefined, () => void][] = [
      [resolved.get("zoom-in"), onZoomIn],
      [resolved.get("zoom-out"), onZoomOut],
      [resolved.get("actual-size"), onZoomReset],
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const [accelerator, run] of actions) {
        if (!accelerator || !matchesAccelerator(event, accelerator, platform)) continue;
        event.preventDefault();
        run();
        return;
      }
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, handleKeyDown);
  }, [platform, onZoomIn, onZoomOut, onZoomReset, overrides]);
}
