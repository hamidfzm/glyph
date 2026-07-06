import { useCallback } from "react";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { runExporter } from "@/lib/plugins/runExporter";
import type { ExporterContribution } from "@/lib/plugins/types";

interface UsePluginExporterRunnerOptions {
  entries: TocEntry[];
  filePath?: string;
  content: string | null;
}

/**
 * Binds the active document's state to the shared plugin-export pipeline so
 * the palette can run a plugin exporter as a plain callback. Failures are
 * logged like the built-in exporters' are.
 */
export function usePluginExporterRunner({
  entries,
  filePath,
  content,
}: UsePluginExporterRunnerOptions): (exporter: ExporterContribution) => void {
  return useCallback(
    (exporter: ExporterContribution) => {
      runExporter({ exporter, entries, filePath, content }).catch((err) => {
        console.error(`Plugin exporter ${exporter.id} failed:`, err);
      });
    },
    [entries, filePath, content],
  );
}
