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

// The themed text menu (Copy / Search / Read Aloud / AI) only makes sense over
// rendered prose. Other surfaces own their own menus: the file tree shows file
// actions, and the rest of the chrome falls through to the native menu.
function isInsideMarkdownContent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".markdown-body") !== null;
}

/**
 * Drives the themed right-click menu for the markdown viewer.
 *
 * The menu only opens over rendered prose (`.markdown-body`); editable fields,
 * surfaces that already claimed the event via preventDefault (the file tree),
 * and the rest of the app chrome keep their own / the native menu. Inside the
 * viewer it suppresses the native menu so the two never stack.
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
      // Only the markdown viewer gets the themed text menu.
      if (!isInsideMarkdownContent(e.target)) return;
      e.preventDefault();
      const selection = window.getSelection()?.toString().trim() ?? "";
      setMenu({ x: e.clientX, y: e.clientY, items: buildContextMenuItems(actions, selection) });
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [actions]);

  return { menu, close };
}
