import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExportFormat } from "@/lib/export/writeExport";
import { pickSave } from "@/lib/pickers";
import type { PrintSettings } from "@/lib/settings";
import type { TocEntry } from "./useTableOfContents";

export type { ExportFormat };

interface UseExportOptions {
  entries: TocEntry[];
  settings: PrintSettings;
  filePath: string | undefined;
  content: string | null;
}

export interface ExportHandlers {
  exportHtml: () => Promise<void>;
  exportDocx: () => Promise<void>;
  exportEpub: () => Promise<void>;
  exportPdf: () => Promise<void>;
  // The format currently being written, or null when idle. Drives the progress
  // indicator; a document with many embedded images can take a noticeable
  // moment to assemble.
  exporting: ExportFormat | null;
}

/**
 * Export the active document to HTML/DOCX/EPUB/PDF. Reuses the rendered
 * `.markdown-body` DOM for fidelity, shows a native save dialog, and writes a
 * file via Rust commands (text for HTML, bytes for DOCX/EPUB/PDF), with no
 * print dialog. The separate File > Print item is the print-dialog path.
 */
export function useExport({
  entries,
  settings,
  filePath,
  content,
}: UseExportOptions): ExportHandlers {
  const { t } = useTranslation("common");
  const includeToc = settings.includeToc;
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const run = useCallback(
    async (format: ExportFormat) => {
      // The canvas check runs first: cards contain their own small
      // `.markdown-body` elements which would fool the document guard.
      const canvas = document.querySelector(".glyph-canvas") !== null;
      // Cheap guard so we don't pop a save dialog with nothing to export.
      if (!canvas && !document.querySelector(".markdown-body")) return;

      try {
        // The export pipeline is loaded on first use so none of it (nor its
        // docx/epub/pdf dependencies) weighs down startup; a failed chunk load
        // lands in the same catch as a failed export.
        const [{ exportCanvas }, { exportDocument }, { deriveExportMeta }, { EXPORT_EXT }] =
          await Promise.all([
            import("@/lib/export/exportCanvas"),
            import("@/lib/export/exportDocument"),
            import("@/lib/export/meta"),
            import("@/lib/export/writeExport"),
          ]);

        const meta = deriveExportMeta(filePath, content);
        const ext = EXPORT_EXT[format];
        const path = await pickSave(`${meta.baseName}.${ext}`, t(`exportFilter.${format}`), [ext]);
        if (!path) return; // user cancelled

        // Show the indicator only for the real work, after the (blocking)
        // native dialog: image inlining and the build/write.
        setExporting(format);
        if (canvas) await exportCanvas(format, path, meta);
        else await exportDocument(format, path, meta, { entries, includeToc });
      } catch (err) {
        console.error(`Failed to export ${format}:`, err);
      } finally {
        setExporting(null);
      }
    },
    [entries, includeToc, filePath, content, t],
  );

  // Handler identities depend only on `run`, so they stay stable while
  // `exporting` toggles — the menu-event subscription isn't torn down mid-export.
  const handlers = useMemo(
    () => ({
      exportHtml: () => run("html"),
      exportDocx: () => run("docx"),
      exportEpub: () => run("epub"),
      exportPdf: () => run("pdf"),
    }),
    [run],
  );

  return { ...handlers, exporting };
}
