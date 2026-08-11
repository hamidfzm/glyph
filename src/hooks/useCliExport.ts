import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { getCliExportRequest } from "@/lib/cliExport";

// How long the CLI export waits for the plugin host's startup load. A hung
// plugin must not hang a CI job forever: past this, the export proceeds with
// whatever themes have registered (a missing plugin theme then fails loudly
// with the available ids, which beats a silent stall).
export const CLI_PLUGIN_WAIT_MS = 10_000;

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
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  const remarkPlugins = useRegistryEntries(plugins?.remarkPlugins ?? null);
  const rehypePlugins = useRegistryEntries(plugins?.rehypePlugins ?? null);
  // Without a provider there are no plugins to wait for.
  const pluginsReady = plugins === null || plugins.initialLoadDone;
  const { settings, loaded } = useSettings();

  // Held in refs so the document's own churn (a growing TOC, streaming
  // content) doesn't re-run the effect while an export is in flight.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const contentRef = useRef(content);
  contentRef.current = content;
  const includeTocRef = useRef(settings.print.includeToc);
  includeTocRef.current = settings.print.includeToc;

  const [waitExpired, setWaitExpired] = useState(false);
  useEffect(() => {
    if (pluginsReady) return;
    const timer = window.setTimeout(() => setWaitExpired(true), CLI_PLUGIN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [pluginsReady]);

  useEffect(() => {
    if (!loaded) return;
    if (!pluginsReady && !waitExpired) return;
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
            themes: pluginThemes,
            remarkPlugins,
            rehypePlugins,
          });
          message = `Exported ${result.pages} pages and ${result.assets} assets to ${request.output}`;
        } else {
          const { runCliDocumentExport } = await import("@/lib/export/cliDocumentExport");
          const { path, settled } = await runCliDocumentExport(request, {
            entries: entriesRef.current,
            includeToc: includeTocRef.current,
            content: contentRef.current,
          });
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
  }, [loaded, pluginsReady, waitExpired, pluginThemes, remarkPlugins, rehypePlugins]);
}
