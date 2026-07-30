import type { ComponentType } from "react";
import { CommandPaletteIcon } from "@/components/icons/CommandPaletteIcon";
import { GraphIcon } from "@/components/icons/GraphIcon";

export interface ActionBarItem {
  id: string;
  /** Key in the `common` namespace. */
  labelKey: string;
  Icon: ComponentType<{ className?: string }>;
  run: () => void;
}

export interface ActionBarOptions {
  openPalette: () => void;
  openGraph: () => void;
  hasWorkspace: boolean;
}

// The palette and the graph otherwise need a keyboard shortcut or the native
// menu, neither of which exists on mobile.
export function actionBarItems(options: ActionBarOptions): ActionBarItem[] {
  const items: ActionBarItem[] = [
    {
      id: "commandPalette",
      labelKey: "tabBar.commandPalette",
      Icon: CommandPaletteIcon,
      run: options.openPalette,
    },
  ];
  // Without a workspace `openGraph` is a no-op and the native menu item is
  // disabled, so the button is hidden rather than silently doing nothing.
  if (options.hasWorkspace) {
    items.push({
      id: "openGraph",
      labelKey: "tabBar.openGraph",
      Icon: GraphIcon,
      run: options.openGraph,
    });
  }
  return items;
}
