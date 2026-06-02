import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

export interface MenuEventHandlers {
  openFile: () => void;
  openFolder: () => void;
  closeTab: () => void;
  toggleFilesSidebar: () => void;
  toggleOutlineSidebar: () => void;
  resetView: () => void;
  openSettings: () => void;
  find: () => void;
  toggleEdit: () => void;
  print: () => void;
  exportHtml: () => void;
  exportDocx: () => void;
  exportEpub: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  aiAction: (action: string) => void;
  readAloud: () => void;
}

// Subscribes to every `menu-*` event emitted by the Rust menu. Pass in a
// fresh callbacks object each render; the subscription is re-installed if
// any handler reference changes, so callers should memoise.
export function useMenuEvents(handlers: MenuEventHandlers) {
  useEffect(() => {
    const subscriptions = [
      listen("menu-open-file", handlers.openFile),
      listen("menu-open-folder", handlers.openFolder),
      listen("menu-close-tab", handlers.closeTab),
      listen("menu-toggle-files-sidebar", handlers.toggleFilesSidebar),
      listen("menu-toggle-outline-sidebar", handlers.toggleOutlineSidebar),
      listen("menu-reset-view", handlers.resetView),
      listen("menu-open-settings", handlers.openSettings),
      listen("menu-find", handlers.find),
      listen("menu-toggle-edit", handlers.toggleEdit),
      listen("menu-print", handlers.print),
      listen("menu-export-html", handlers.exportHtml),
      listen("menu-export-docx", handlers.exportDocx),
      listen("menu-export-epub", handlers.exportEpub),
      listen("menu-zoom-in", handlers.zoomIn),
      listen("menu-zoom-out", handlers.zoomOut),
      listen("menu-zoom-reset", handlers.zoomReset),
      listen<string>("menu-ai-action", (event) => handlers.aiAction(event.payload)),
      listen("menu-ai-read-aloud", handlers.readAloud),
    ];
    return () => {
      for (const sub of subscriptions) {
        sub.then((fn) => fn());
      }
    };
  }, [handlers]);
}
