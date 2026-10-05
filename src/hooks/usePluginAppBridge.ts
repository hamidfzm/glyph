import { useEffect } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { locateLineInDocument, locateWhenRendered } from "@/lib/documentHighlight";
import { setPluginAppState } from "@/lib/plugins/appState";
import { setPluginFileOpener } from "@/lib/plugins/navigationApi";

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
  const text = activeFile ? (activeFile.editContent ?? activeFile.content) : null;

  useEffect(() => {
    setPluginAppState({
      workspaceRoot: root,
      activeDocument: path === undefined ? null : { path, text },
      snapshot,
    });
  }, [root, path, text, snapshot]);

  useEffect(() => {
    let cancelLocate: (() => void) | undefined;
    setPluginFileOpener((target, line) => {
      cancelLocate?.();
      openFile(target);
      if (line !== undefined) {
        cancelLocate = locateWhenRendered(() => locateLineInDocument(line));
      }
      // On a phone the sidebar is a drawer over the document.
      if (compact) closeCompactPanels();
    });
    return () => {
      cancelLocate?.();
      setPluginFileOpener(null);
    };
  }, [openFile, compact, closeCompactPanels]);
}
