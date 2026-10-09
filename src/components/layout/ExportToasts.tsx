import type { ExportFormat } from "@/hooks/useExport";
import type { SiteExportNotice, SiteExportProgress } from "@/hooks/useExportSite";
import { ExportNotice } from "./ExportNotice";
import { ExportProgress } from "./ExportProgress";

interface ExportToastsProps {
  /** The single-document format being written, or null when idle. */
  exporting: ExportFormat | null;
  siteProgress: SiteExportProgress | null;
  siteNotice: SiteExportNotice | null;
  onDismissSiteNotice: () => void;
}

/**
 * The export toasts, stacked bottom-center above the status bar: a notice waits
 * to be dismissed, so the progress of a later export must sit beside it rather
 * than over it. Only the notice takes clicks; the rest of the stack lets them
 * through.
 */
export function ExportToasts({
  exporting,
  siteProgress,
  siteNotice,
  onDismissSiteNotice,
}: ExportToastsProps) {
  if (!exporting && !siteProgress && !siteNotice) return null;
  return (
    <div
      data-print-hide="true"
      className="pointer-events-none fixed bottom-[calc(var(--glyph-safe-bottom)+2.5rem)] left-1/2 -translate-x-1/2 z-50 flex w-max max-w-[90vw] flex-col items-center gap-2"
    >
      {siteNotice && <ExportNotice notice={siteNotice} onDismiss={onDismissSiteNotice} />}
      {exporting && <ExportProgress format={exporting} />}
      {siteProgress && <ExportProgress format="website" progress={siteProgress} />}
    </div>
  );
}
