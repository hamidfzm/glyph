import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { useExportReadiness } from "@/hooks/useExportReadiness";
import { useSettings } from "@/hooks/useSettings";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { getCliExportRequest } from "@/lib/cliExport";
import { epubMediaLimitBytes } from "@/lib/settings";

// Once-per-process latch: the effect may fire more than once (StrictMode,
// plugin readiness flipping) but the export itself must not.
let started = false;

/** Test-only: allow each test to run the effect fresh. */
export function resetCliExportRunner(): void {
  started = false;
}

interface UseCliExportOptions {
  entries: TocEntry[];
  content: string | null;
}

/**
 * Runs the headless CLI export (`glyph <path> --export <format>`). When the
 * process was launched with an export request, the window stays hidden (see
 * useWindowReveal), the document or workspace renders straight to disk, and the
 * process exits: 0 on success, 1 with a stderr message on failure. On
 * interactive launches this resolves to a no-op.
 *
 * Waits for persisted settings (the print options an export honors) and for the
 * plugin host's startup load, so a theme contributed by a plugin is registered
 * by the time the config names it.
 */
export function useCliExport({ entries, content }: UseCliExportOptions): void {
  const { ready, themes, remarkPlugins, rehypePlugins } = useExportReadiness();
  const { settings } = useSettings();

  // Held in refs so the document's own churn (a growing TOC, streaming
  // content) doesn't re-run the effect while an export is in flight, and so
  // the runner can read them once the document has actually rendered.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const contentRef = useRef(content);
  contentRef.current = content;
  const includeTocRef = useRef(settings.print.includeToc);
  includeTocRef.current = settings.print.includeToc;
  const epubMediaLimitRef = useRef(settings.print.epubMediaLimit);
  epubMediaLimitRef.current = settings.print.epubMediaLimit;

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const request = await getCliExportRequest();
      if (!request || started) return;
      started = true;
      try {
        let message: string;
        if (request.format === "site") {
          const { exportSite } = await import("@/lib/export/site/exportSite");
          const result = await exportSite({
            root: request.input,
            outDir: request.output,
            themes,
            remarkPlugins,
            rehypePlugins,
          });
          message = `Exported ${result.pages} pages and ${result.assets} assets to ${request.output}`;
        } else {
          const { runCliDocumentExport } = await import("@/lib/export/cliDocumentExport");
          const { path, settled } = await runCliDocumentExport(request, () => ({
            entries: entriesRef.current,
            includeToc: includeTocRef.current,
            content: contentRef.current,
            epubMediaLimit: epubMediaLimitBytes(epubMediaLimitRef.current),
          }));
          // A document that never settled still exports, but says so: silently
          // shipping one with missing diagrams is worse than a noisy success.
          message = settled
            ? `Exported ${path}`
            : `Exported ${path} (the document did not finish rendering; diagrams may be missing)`;
        }
        await invoke("finish_cli_export", { code: 0, message });
      } catch (err) {
        await invoke("finish_cli_export", {
          code: 1,
          message: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  }, [ready, themes, remarkPlugins, rehypePlugins]);
}
