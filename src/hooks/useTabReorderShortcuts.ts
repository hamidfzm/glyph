import { useBoundShortcuts } from "@/hooks/useBoundShortcuts";
import type { Platform } from "@/hooks/usePlatform";

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
  useBoundShortcuts(platform, {
    "move-tab-left": () => onMove(-1),
    "move-tab-right": () => onMove(1),
  });
}
