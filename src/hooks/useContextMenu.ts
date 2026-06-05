import { useCallback, useEffect, useState } from "react";
import {
  buildContextMenuItems,
  type ContextMenuActions,
  type ContextMenuItem,
} from "@/lib/contextMenuItems";

export type { ContextMenuActions } from "@/lib/contextMenuItems";

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

// Editable surfaces keep the WebView's native menu so Cut / Copy / Paste and
// spell-check suggestions stay available; our themed menu doesn't edit text.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, [contenteditable=''], [contenteditable='true']") !== null;
}

/**
 * Drives the in-app right-click menu and suppresses the WebView's native
 * ("browser") context menu so the two never stack on top of each other.
 *
 * The native menu is kept only where it's genuinely useful (editable fields)
 * and when another handler (e.g. the file tree) has already claimed the event
 * via preventDefault. Everywhere else we show the themed menu instead, on every
 * platform, so it matches the app's fonts and colors rather than the OS.
 */
export function useContextMenu(actions: ContextMenuActions) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // A more specific handler already took this event and called
      // preventDefault; don't stack our menu on top of theirs.
      if (e.defaultPrevented) return;
      // Editable fields keep the native Cut / Copy / Paste menu.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const selection = window.getSelection()?.toString().trim() ?? "";
      setMenu({ x: e.clientX, y: e.clientY, items: buildContextMenuItems(actions, selection) });
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [actions]);

  return { menu, close };
}
