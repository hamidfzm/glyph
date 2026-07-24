import { useEffect } from "react";
import { subscribe } from "@/lib/tauriEvent";

export interface MenuEventHandlers {
  openFile: () => void;
  openFolder: () => void;
  newWorkspace: () => void;
  openGraph: () => void;
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

// Subscribes to every `menu-*` event emitted by the Rust menu. Pass in a
// fresh callbacks object each render; the subscription is re-installed if
// any handler reference changes, so callers should memoise.
export function useMenuEvents(handlers: MenuEventHandlers) {
  useEffect(() => {
    const unsubscribes = [
      subscribe("menu-open-file", handlers.openFile),
      subscribe("menu-open-folder", handlers.openFolder),
      subscribe("menu-new-workspace", handlers.newWorkspace),
      subscribe("menu-open-graph", handlers.openGraph),
      subscribe("menu-close-tab", handlers.closeTab),
      subscribe("menu-close-workspace", handlers.closeWorkspace),
      subscribe("menu-toggle-files-sidebar", handlers.toggleFilesSidebar),
      subscribe("menu-toggle-outline-sidebar", handlers.toggleOutlineSidebar),
      subscribe("menu-reset-view", handlers.resetView),
      subscribe("menu-open-settings", handlers.openSettings),
      subscribe("menu-open-sync-settings", handlers.openSyncSettings),
      subscribe("menu-manage-plugins", handlers.managePlugins),
      subscribe("menu-find", handlers.find),
      subscribe("menu-toggle-edit", handlers.toggleEdit),
      subscribe("menu-print", handlers.print),
      subscribe("menu-export-html", handlers.exportHtml),
      subscribe("menu-export-docx", handlers.exportDocx),
      subscribe("menu-export-epub", handlers.exportEpub),
      subscribe("menu-export-pdf", handlers.exportPdf),
      subscribe("menu-export-website", handlers.exportWebsite),
      subscribe("menu-workspace-settings", handlers.workspaceSettings),
      subscribe("menu-zoom-in", handlers.zoomIn),
      subscribe("menu-zoom-out", handlers.zoomOut),
      subscribe("menu-zoom-reset", handlers.zoomReset),
      subscribe<string>("menu-ai-action", (event) => handlers.aiAction(event.payload)),
      subscribe("menu-ai-chat", handlers.aiChat),
      subscribe("menu-ai-read-aloud", handlers.readAloud),
      subscribe("menu-documentation", handlers.documentation),
      subscribe("menu-release-notes", handlers.releaseNotes),
      subscribe("menu-report-issue", handlers.reportIssue),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [handlers]);
}
