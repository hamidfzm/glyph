import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { buildTocElement } from "@/lib/export/toc";
import type { PrintSettings } from "../lib/settings";
import type { TocEntry } from "./useTableOfContents";

interface UsePrintOptions {
  entries: TocEntry[];
  settings: PrintSettings;
}

export function usePrint({ entries, settings }: UsePrintOptions) {
  return useCallback(() => {
    const body = document.querySelector<HTMLElement>(".markdown-body");
    // Canvas cards carry their own small markdown bodies; printing one of
    // those is never what the user wants. Export the board as PNG instead.
    if (!body || body.closest(".glyph-canvas")) return;

    const root = document.documentElement;
    root.setAttribute("data-print-breaks", settings.pageBreakLevel);
    root.setAttribute("data-print-bg", String(settings.includeBackground));

    let injected: HTMLElement | null = null;
    if (settings.includeToc && entries.length > 0) {
      injected = buildTocElement(entries);
      body.insertBefore(injected, body.firstChild);
    }

    const cleanup = () => {
      root.removeAttribute("data-print-breaks");
      root.removeAttribute("data-print-bg");
      if (injected?.parentNode) {
        injected.parentNode.removeChild(injected);
      }
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);

    // Use the native Tauri webview print() — window.print() is unreliable
    // on macOS WKWebView. Fall back to window.print() if the command fails
    // (e.g. running in a plain browser for tests).
    invoke("print_document").catch(() => {
      window.print();
    });
  }, [entries, settings.pageBreakLevel, settings.includeBackground, settings.includeToc]);
}
