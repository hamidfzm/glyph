import { useEffect } from "react";
import type { Platform } from "./usePlatform";

interface ContextMenuActions {
  openFileDialog: () => void;
  toggleSidebar: () => void;
  ttsSpeak?: (text: string) => void;
  ttsStop?: () => void;
  ttsSpeaking?: boolean;
  ttsAvailable?: boolean;
  aiAction?: (action: string, text: string) => void;
  aiConfigured?: boolean;
  content?: string | null;
}

export function useContextMenu(platform: Platform, actions: ContextMenuActions) {
  useEffect(() => {
    // On macOS, keep native WebView context menu (has Look Up, Translate, Summarize, Speech, etc.)
    if (platform === "macos" || platform === "unknown") return;

    const handler = async (e: MouseEvent) => {
      e.preventDefault();

      const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import("@tauri-apps/api/menu");

      const selection = window.getSelection()?.toString() ?? "";
      const items: Array<
        | Awaited<ReturnType<typeof MenuItem.new>>
        | Awaited<ReturnType<typeof PredefinedMenuItem.new>>
        | Awaited<ReturnType<typeof Submenu.new>>
      > = [];

      // Copy + Select All
      items.push(await PredefinedMenuItem.new({ item: "Copy" }));
      items.push(await PredefinedMenuItem.new({ item: "SelectAll" }));
      items.push(await PredefinedMenuItem.new({ item: "Separator" }));

      // Search Google (if selection)
      if (selection) {
        items.push(
          await MenuItem.new({
            text: `Search Google for "${selection.slice(0, 30)}${selection.length > 30 ? "\u2026" : ""}"`,
            action: () => {
              const url = `https://www.google.com/search?q=${encodeURIComponent(selection)}`;
              window.open(url, "_blank");
            },
          }),
        );
        items.push(await PredefinedMenuItem.new({ item: "Separator" }));
      }

      // TTS
      if (actions.ttsAvailable) {
        if (actions.ttsSpeaking) {
          items.push(
            await MenuItem.new({
              text: "Stop Reading",
              action: () => actions.ttsStop?.(),
            }),
          );
        } else {
          const textToRead = selection || actions.content || "";
          if (textToRead) {
            items.push(
              await MenuItem.new({
                text: selection ? "Read Selection Aloud" : "Read Aloud",
                action: () => actions.ttsSpeak?.(textToRead),
              }),
            );
          }
        }
      }

      // AI actions (if provider configured)
      if (actions.aiConfigured) {
        const textForAI = selection || actions.content || "";
        if (textForAI) {
          const aiItems = [];
          for (const action of ["Summarize", "Explain", "Translate", "Simplify"]) {
            aiItems.push(
              await MenuItem.new({
                text: selection ? `${action} Selection` : `${action} Document`,
                action: () => actions.aiAction?.(action.toLowerCase(), textForAI),
              }),
            );
          }

          items.push(await PredefinedMenuItem.new({ item: "Separator" }));
          items.push(
            await Submenu.new({
              text: "AI",
              items: aiItems,
            }),
          );
        }
      }

      // Open File + Toggle Sidebar
      items.push(await PredefinedMenuItem.new({ item: "Separator" }));
      items.push(
        await MenuItem.new({
          text: "Open File\u2026",
          action: () => actions.openFileDialog(),
        }),
      );
      items.push(
        await MenuItem.new({
          text: "Toggle Sidebar",
          action: () => actions.toggleSidebar(),
        }),
      );

      const menu = await Menu.new({ items });
      await menu.popup();
    };

    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [platform, actions]);
}
