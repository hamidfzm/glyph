import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextMenuModel } from "@/components/menu/ContextMenu";
import { useTabsContext } from "@/contexts/TabsContext";
import { useOpenInNewWindow } from "@/hooks/useOpenInNewWindow";
import { buildTabMenuItems } from "@/lib/tabMenuItems";

interface TabMenuState {
  x: number;
  y: number;
  tabId: string;
}

/** Right-click menu for the tab strip. `openAt` suppresses the native menu,
 *  which also stops the app-wide handler in `useContextMenu` from reacting. */
export function useTabContextMenu() {
  const { t } = useTranslation("common");
  const { tabs, closeTabs } = useTabsContext();
  const openInNewWindow = useOpenInNewWindow();
  const [state, setState] = useState<TabMenuState | null>(null);
  const close = useCallback(() => setState(null), []);

  const openAt = useCallback((e: MouseEvent, tabId: string) => {
    e.preventDefault();
    // The Menu key raises contextmenu with no pointer position, which WebKit
    // reports as 0,0; anchor those to the tab instead of the viewport corner.
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const rect = e.currentTarget.getBoundingClientRect();
    setState({
      x: keyboard ? rect.left : e.clientX,
      y: keyboard ? rect.bottom : e.clientY,
      tabId,
    });
  }, []);

  const menu = useMemo<ContextMenuModel | null>(() => {
    if (!state) return null;
    const items = buildTabMenuItems(tabs, state.tabId, closeTabs, openInNewWindow, t);
    // The tab can disappear under an open menu (an external delete closes it),
    // which would otherwise leave an empty popup behind.
    if (items.length === 0) return null;
    return { x: state.x, y: state.y, items };
  }, [state, tabs, closeTabs, openInNewWindow, t]);

  return { menu, openAt, close };
}
