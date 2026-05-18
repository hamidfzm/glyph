import { useEffect } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { KEYBOARD_EVENT, matchesRedoShortcut, matchesUndoShortcut } from "@/lib/keyboard";

interface UseDocumentUndoRedoOptions {
  activeTabId: string | null;
  platform: Platform;
  onUndo: (tabId: string) => void;
  onRedo: (tabId: string) => void;
}

// Global keyboard shortcut for programmatic-edit undo/redo (task toggles,
// future rename refactors). CodeMirror keeps its own history for typed
// input; we defer to it whenever focus is inside the editor pane.
export function useDocumentUndoRedo({
  activeTabId,
  platform,
  onUndo,
  onRedo,
}: UseDocumentUndoRedoOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isUndo = matchesUndoShortcut(event, platform);
      const isRedo = !isUndo && matchesRedoShortcut(event, platform);
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
  }, [activeTabId, platform, onUndo, onRedo]);
}
