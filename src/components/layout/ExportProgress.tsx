import { useTranslation } from "react-i18next";
import type { ExportFormat } from "@/hooks/useExport";
import type { SiteExportProgress } from "@/hooks/useExportSite";

interface ExportProgressProps {
  format: ExportFormat | "website";
  /** Determinate page counts for the website export; omitted for single-file. */
  progress?: SiteExportProgress | null;
}

/**
 * Small non-blocking toast shown while an export is being assembled and
 * written. Export reuses the rendered DOM and inlines images, which can take a
 * moment for image-heavy documents, so the user gets explicit feedback rather
 * than a silent pause. The website export renders many files and reports
 * determinate N-of-M progress instead.
 */
export function ExportProgress({ format, progress }: ExportProgressProps) {
  const { t } = useTranslation("common");
  const label =
    progress && progress.total > 0
      ? t("exportProgress.exportingPages", { done: progress.done, total: progress.total })
      : t("exportProgress.exporting", { format: t(`exportProgress.${format}`) });
  return (
    <div
      role="status"
      aria-live="polite"
      data-export-ignore="true"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] shadow-lg select-none"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin"
      />
      {label}
    </div>
  );
}
