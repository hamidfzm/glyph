import { useEffect } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import { matchesAccelerator, resolveBindings } from "@/lib/keybindings";
import { KEYBOARD_EVENT } from "@/lib/keyboard";
import { isMac } from "@/lib/platform";

interface UseDocumentUndoRedoOptions {
  activeTabId: string | null;
  platform: Platform;
  onUndo: (tabId: string) => void;
  onRedo: (tabId: string) => void;
}

// Global keyboard shortcut for programmatic-edit undo/redo (task toggles,
// future rename refactors). The undo/redo bindings come from the resolved
// keybindings (remappable in Settings → Hotkeys). CodeMirror keeps its own
// history for typed input; we defer to it whenever focus is inside the editor.
export function useDocumentUndoRedo({
  activeTabId,
  platform,
  onUndo,
  onRedo,
}: UseDocumentUndoRedoOptions) {
  const { settings } = useSettings();
  const overrides = settings.keybindings.overrides;

  useEffect(() => {
    const resolved = resolveBindings(overrides);
    const undoAccel = resolved.get("undo");
    const redoAccel = resolved.get("redo");

    const onKeyDown = (event: KeyboardEvent) => {
      const isUndo = !!undoAccel && matchesAccelerator(event, undoAccel, platform);
      // Ctrl+Y is the Windows/Linux redo convention; keep it working alongside
      // the (remappable) primary redo binding.
      const isLegacyRedoY =
        !isMac(platform) &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === "KeyY";
      const isRedo =
        !isUndo &&
        ((!!redoAccel && matchesAccelerator(event, redoAccel, platform)) || isLegacyRedoY);
      if (!isUndo && !isRedo) return;
      const target = event.target as Element | null;
      if (target?.closest(".cm-editor")) return;
      if (!activeTabId) return;
      event.preventDefault();
      if (isUndo) onUndo(activeTabId);
      else onRedo(activeTabId);
    };
    document.addEventListener(KEYBOARD_EVENT.KeyDown, onKeyDown);
    return () => document.removeEventListener(KEYBOARD_EVENT.KeyDown, onKeyDown);
  }, [activeTabId, platform, onUndo, onRedo, overrides]);
}
