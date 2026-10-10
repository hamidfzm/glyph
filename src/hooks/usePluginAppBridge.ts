import { useEffect } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { locateLineInDocument, locateWhenRendered } from "@/lib/documentHighlight";
import { setPluginAppState } from "@/lib/plugins/appState";
import { setPluginFileOpener } from "@/lib/plugins/navigationApi";
import { liveContentOf } from "@/lib/tabs";

/**
 * Mirror what plugins may read of the app (workspace root, active document,
 * workspace index) into the plugin layer, and let `ctx.navigation` open files.
 * Needed because PluginsProvider mounts above TabsProvider and cannot read the
 * tabs context itself.
 */
export function usePluginAppBridge(): void {
  const { workspace, activeFile, snapshot, openFile } = useTabsContext();
  const { compact, closeCompactPanels } = useSidebarLayoutContext();
  const root = workspace?.root ?? null;
  const path = activeFile?.path;
  const text = activeFile ? liveContentOf(activeFile) : null;

  useEffect(() => {
    setPluginAppState({
      workspaceRoot: root,
      activeDocument: path === undefined ? null : { path, text },
      snapshot,
    });
  }, [root, path, text, snapshot]);

  useEffect(() => {
    let cancelLocate: (() => void) | undefined;
    let latest = 0;
    setPluginFileOpener((target, line) => {
      const request = ++latest;
      cancelLocate?.();
      void openFile(target).then((tabId) => {
        // No tab means the note is not on screen here (another window holds
        // it, or it would not open), so the line has nothing to land on. A
        // newer navigation owns the viewer by now.
        if (line === undefined || tabId === undefined || request !== latest) return;
        cancelLocate = locateWhenRendered(() => locateLineInDocument(line));
      });
      // On a phone the sidebar is a drawer over the document.
      if (compact) closeCompactPanels();
    });
    return () => {
      latest += 1;
      cancelLocate?.();
      setPluginFileOpener(null);
    };
  }, [openFile, compact, closeCompactPanels]);
}
