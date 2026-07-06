import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
// the document's rendered prose. Other surfaces own their own menus: the file
// tree shows file actions, and the rest of the chrome falls through to the
// native menu. Assistant replies in the AI chat panel also render with
// `.markdown-body`, but the document-targeted menu is wrong there (Select All
// and the AI actions operate on the document, not the message; per-message
// Copy / Read Aloud buttons cover the chat), so the panel is excluded.
function isInsideMarkdownContent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".markdown-body") !== null && target.closest(".ai-chat-panel") === null;
}

/**
 * Suppresses the WebView's native ("browser") context menu app-wide and drives
 * the themed menu for the markdown viewer.
 *
 * The native menu (with its Back / Reload / Save as / Inspect entries) is
 * never useful in the app, so it's suppressed everywhere except editable fields
 * (which keep Cut / Copy / Paste) and surfaces that already claimed the event
 * via preventDefault (the file tree). The themed menu itself only opens over
 * rendered prose (`.markdown-body`); other chrome simply shows nothing.
 */
export function useContextMenu(actions: ContextMenuActions) {
  const { t } = useTranslation("common");
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // A more specific handler (the file tree) already took this event and
      // suppressed the native menu; leave it be.
      if (e.defaultPrevented) return;
      // Editable fields keep the native Cut / Copy / Paste menu.
      if (isEditableTarget(e.target)) return;
      // Suppress the native browser menu everywhere else.
      e.preventDefault();
      // Only the markdown viewer shows a themed menu; other chrome shows none.
      if (!isInsideMarkdownContent(e.target)) return;
      const selection = window.getSelection()?.toString().trim() ?? "";
      // Raw attribute, not the resolved `href` property: resolution would turn
      // relative workspace links into http://localhost/... URLs, which would
      // wrongly pass the external-link filter in the builder.
      const linkHref = (e.target as Element).closest("a[href]")?.getAttribute("href") ?? undefined;
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: buildContextMenuItems(actions, selection, t, linkHref),
      });
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [actions, t]);

  return { menu, close };
}
