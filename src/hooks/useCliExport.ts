import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { getCliExportRequest } from "@/lib/cliExport";

// Once-per-process latch: the effect may fire more than once (StrictMode,
// plugin readiness flipping) but the export itself must not.
let started = false;

/** Test-only: allow each test to run the effect fresh. */
export function resetCliExportRunner(): void {
  started = false;
}

/**
 * Runs the headless CLI website export (`glyph <folder> --export-website
 * <outDir>`). When the process was launched with an export request, the
 * window stays hidden (see useWindowReveal), the workspace renders straight
 * to disk, and the process exits: 0 on success, 1 with a stderr message on
 * failure. On interactive launches this resolves to a no-op.
 *
 * Waits for the plugin host's startup load before exporting, so a theme
 * contributed by a plugin is registered by the time the config names it.
 */
export function useCliExport(): void {
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  // Without a provider there are no plugins to wait for.
  const pluginsReady = plugins === null || plugins.initialLoadDone;

  useEffect(() => {
    if (!pluginsReady) return;
    (async () => {
      const request = await getCliExportRequest();
      if (!request || started) return;
      started = true;
      try {
        const { exportSite } = await import("@/lib/export/site/exportSite");
        const result = await exportSite({
          root: request.root,
          outDir: request.outDir,
          themes: pluginThemes,
        });
        await invoke("finish_cli_export", {
          code: 0,
          message: `Exported ${result.pages} pages and ${result.assets} assets to ${request.outDir}`,
        });
      } catch (err) {
        await invoke("finish_cli_export", {
          code: 1,
          message: `Website export failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  }, [pluginsReady, pluginThemes]);
}
