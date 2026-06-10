import type { ExportFormat } from "@/hooks/useExport";

const LABELS: Record<ExportFormat, string> = {
  html: "HTML",
  docx: "Word document",
  epub: "EPUB",
  pdf: "PDF",
  png: "PNG image",
};

/**
 * Small non-blocking toast shown while an export is being assembled and
 * written. Export reuses the rendered DOM and inlines images, which can take a
 * moment for image-heavy documents, so the user gets explicit feedback rather
 * than a silent pause.
 */
export function ExportProgress({ format }: { format: ExportFormat }) {
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
      Exporting {LABELS[format]}…
    </div>
  );
}
