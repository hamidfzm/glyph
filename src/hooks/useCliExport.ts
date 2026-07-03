import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { getCliExportRequest } from "@/lib/cliExport";

// Once-per-process latch: the mount effect may run twice (StrictMode, remount)
// but the export itself must not.
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
 */
export function useCliExport(): void {
  useEffect(() => {
    (async () => {
      const request = await getCliExportRequest();
      if (!request || started) return;
      started = true;
      try {
        const { exportSite } = await import("@/lib/export/site/exportSite");
        const result = await exportSite({ root: request.root, outDir: request.outDir });
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
  }, []);
}
