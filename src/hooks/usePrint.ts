import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { PrintSettings } from "@/lib/settings";
import type { TocEntry } from "./useTableOfContents";

interface UsePrintOptions {
  entries: TocEntry[];
  settings: PrintSettings;
}

export function usePrint({ entries, settings }: UsePrintOptions) {
  return useCallback(async () => {
    const body = document.querySelector<HTMLElement>(".markdown-body");
    // Canvas cards carry their own small markdown bodies; printing one of
    // those is never what the user wants. Export the board as PNG instead.
    if (!body || body.closest(".glyph-canvas")) return;

    // Loaded on first print so the diagram-relight/TOC helpers (and their
    // rasterize dependencies) stay out of the startup bundle. A failed chunk
    // load (corrupted install) aborts with a log, not an unhandled rejection.
    let helpers: [
      typeof import("@/lib/export/lightDiagrams"),
      typeof import("@/lib/export/toc"),
      typeof import("@/lib/export/renderReady"),
    ];
    try {
      helpers = await Promise.all([
        import("@/lib/export/lightDiagrams"),
        import("@/lib/export/toc"),
        import("@/lib/export/renderReady"),
      ]);
    } catch (err) {
      console.error("Print helpers failed to load:", err);
      return;
    }
    const [{ swapDiagramsLight }, { buildTocElement }, { waitForRenderIdle }] = helpers;

    // Print renders the live DOM, so wait out any diagram still compiling or
    // lazy plugin chunk still in flight before touching it. Runs before the
    // TOC injection below so our own mutations aren't what we wait on.
    await waitForRenderIdle();

    const root = document.documentElement;
    root.setAttribute("data-print-breaks", settings.pageBreakLevel);
    root.setAttribute("data-print-bg", String(settings.includeBackground));

    let injected: HTMLElement | null = null;
    if (settings.includeToc && entries.length > 0) {
      injected = buildTocElement(entries);
      body.insertBefore(injected, body.firstChild);
    }

    const restoreDiagrams = root.classList.contains("dark")
      ? await swapDiagramsLight(document)
      : null;

    const cleanup = () => {
      root.removeAttribute("data-print-breaks");
      root.removeAttribute("data-print-bg");
      restoreDiagrams?.();
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
