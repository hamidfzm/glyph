import { useEffect } from "react";
import { subscribe } from "@/lib/tauriEvent";

export interface MenuEventHandlers {
  openFile: () => void;
  openFolder: () => void;
  openGraph: () => void;
  save: () => void;
  toggleAutoSave: () => void;
  closeTab: () => void;
  closeWorkspace: () => void;
  toggleFilesSidebar: () => void;
  toggleOutlineSidebar: () => void;
  resetView: () => void;
  openSettings: () => void;
  openSyncSettings: () => void;
  managePlugins: () => void;
  find: () => void;
  toggleEdit: () => void;
  print: () => void;
  exportHtml: () => void;
  exportDocx: () => void;
  exportEpub: () => void;
  exportPdf: () => void;
  exportWebsite: () => void;
  workspaceSettings: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  aiAction: (action: string) => void;
  aiChat: () => void;
  readAloud: () => void;
  documentation: () => void;
  releaseNotes: () => void;
  reportIssue: () => void;
}

/** Canonical `menu-*` event to handler mapping. Shared by the Tauri event
 *  subscription below and the keyboard fallback in `useMenuShortcuts`, so the
 *  two can never drift. `menu-ai-action` is excluded: it carries a payload. */
export function menuEventActions(handlers: MenuEventHandlers): Record<string, () => void> {
  return {
    "menu-open-file": handlers.openFile,
    "menu-open-folder": handlers.openFolder,
    "menu-open-graph": handlers.openGraph,
    "menu-save": handlers.save,
    "menu-toggle-auto-save": handlers.toggleAutoSave,
    "menu-close-tab": handlers.closeTab,
    "menu-close-workspace": handlers.closeWorkspace,
    "menu-toggle-files-sidebar": handlers.toggleFilesSidebar,
    "menu-toggle-outline-sidebar": handlers.toggleOutlineSidebar,
    "menu-reset-view": handlers.resetView,
    "menu-open-settings": handlers.openSettings,
    "menu-open-sync-settings": handlers.openSyncSettings,
    "menu-manage-plugins": handlers.managePlugins,
    "menu-find": handlers.find,
    "menu-toggle-edit": handlers.toggleEdit,
    "menu-print": handlers.print,
    "menu-export-html": handlers.exportHtml,
    "menu-export-docx": handlers.exportDocx,
    "menu-export-epub": handlers.exportEpub,
    "menu-export-pdf": handlers.exportPdf,
    "menu-export-website": handlers.exportWebsite,
    "menu-workspace-settings": handlers.workspaceSettings,
    "menu-zoom-in": handlers.zoomIn,
    "menu-zoom-out": handlers.zoomOut,
    "menu-zoom-reset": handlers.zoomReset,
    "menu-ai-chat": handlers.aiChat,
    "menu-ai-read-aloud": handlers.readAloud,
    "menu-documentation": handlers.documentation,
    "menu-release-notes": handlers.releaseNotes,
    "menu-report-issue": handlers.reportIssue,
  };
}

// Subscribes to every `menu-*` event emitted by the Rust menu. Pass in a
// fresh callbacks object each render; the subscription is re-installed if
// any handler reference changes, so callers should memoise.
export function useMenuEvents(handlers: MenuEventHandlers) {
  useEffect(() => {
    const unsubscribes = Object.entries(menuEventActions(handlers)).map(([event, run]) =>
      subscribe(event, run),
    );
    unsubscribes.push(
      subscribe<string>("menu-ai-action", (event) => handlers.aiAction(event.payload)),
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [handlers]);
}
