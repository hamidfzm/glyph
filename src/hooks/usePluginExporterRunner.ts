import { useCallback } from "react";
import { runExporter } from "@/lib/plugins/runExporter";
import type { ExporterContribution } from "@/lib/plugins/types";

interface UsePluginExporterRunnerOptions {
  filePath?: string;
  content: string | null;
}

/**
 * Binds the active document's state to the shared plugin-export pipeline so
 * the palette can run a plugin exporter as a plain callback. Failures are
 * logged like the built-in exporters' are.
 */
export function usePluginExporterRunner({
  filePath,
  content,
}: UsePluginExporterRunnerOptions): (exporter: ExporterContribution) => void {
  return useCallback(
    (exporter: ExporterContribution) => {
      runExporter({ exporter, filePath, content }).catch((err) => {
        console.error(`Plugin exporter ${exporter.id} failed:`, err);
      });
    },
    [filePath, content],
  );
}
