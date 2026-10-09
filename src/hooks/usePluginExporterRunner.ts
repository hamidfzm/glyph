import { useCallback } from "react";
import { errorMessage } from "@/lib/errorMessage";
import { runExporter } from "@/lib/plugins/runExporter";
import type { ExporterContribution } from "@/lib/plugins/types";
import type { ExportNoticeActions } from "./useExportNotice";

interface UsePluginExporterRunnerOptions extends ExportNoticeActions {
  filePath?: string;
  content: string | null;
}

/**
 * Binds the active document's state to the shared plugin-export pipeline so
 * the palette and the File > Export menu can run a plugin exporter as a plain
 * callback. A failure is reported in the export notice, as a built-in
 * exporter's is.
 */
export function usePluginExporterRunner({
  filePath,
  content,
  showNotice,
  captureSeenNotice,
}: UsePluginExporterRunnerOptions): (exporter: ExporterContribution) => void {
  return useCallback(
    (exporter: ExporterContribution) => {
      const dropSeenNotice = captureSeenNotice();
      runExporter({
        exporter,
        filePath,
        content,
        onDestinationPicked: dropSeenNotice,
      }).catch((err) => {
        console.error(`Plugin exporter ${exporter.id} failed:`, err);
        showNotice({ kind: "failed", reason: errorMessage(err) });
      });
    },
    [filePath, content, showNotice, captureSeenNotice],
  );
}
