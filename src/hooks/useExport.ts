import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo, useState } from "react";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument } from "@/lib/export/html";
import { deriveExportMeta } from "@/lib/export/meta";
import { prepareContent } from "@/lib/export/prepareContent";
import type { PrintSettings } from "@/lib/settings";
import type { TocEntry } from "./useTableOfContents";

export type ExportFormat = "html" | "docx" | "epub" | "pdf";

interface UseExportOptions {
  entries: TocEntry[];
  settings: PrintSettings;
  filePath: string | undefined;
  content: string | null;
}

const FILTERS: Record<ExportFormat, { name: string; ext: string }> = {
  html: { name: "HTML", ext: "html" },
  docx: { name: "Word Document", ext: "docx" },
  epub: { name: "EPUB", ext: "epub" },
  pdf: { name: "PDF", ext: "pdf" },
};

// Write binary export output via the Rust command. The bytes are sent as a
// plain number array: `@tauri-apps/api`'s `invoke` JSON-serializes arguments,
// and a nested `Uint8Array` would become an object (`{"0":..}`) that Rust's
// `Vec<u8>` can't deserialize — so DOCX/EPUB/PDF must be converted first.
function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  return invoke("write_binary_file", { path, contents: Array.from(bytes) });
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
 * file via Rust commands (text for HTML, bytes for DOCX/EPUB/PDF) — no print
 * dialog. The separate File > Print item is the print-dialog path.
 */
export function useExport({
  entries,
  settings,
  filePath,
  content,
}: UseExportOptions): ExportHandlers {
  const includeToc = settings.includeToc;
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const run = useCallback(
    async (format: ExportFormat) => {
      // Cheap guard so we don't pop a save dialog with nothing to export.
      if (!document.querySelector(".markdown-body")) return;

      const meta = deriveExportMeta(filePath, content);
      const { name, ext } = FILTERS[format];
      const path = await save({
        defaultPath: `${meta.baseName}.${ext}`,
        filters: [{ name, extensions: [ext] }],
      });
      if (!path) return; // user cancelled

      // Show the indicator only for the real work — after the (blocking) native
      // dialog, covering image inlining and the build/write.
      setExporting(format);
      try {
        const prepared = await prepareContent({
          entries,
          includeToc,
          // PDF can't compute styles itself; inline the code colors for it.
          inlineCodeColors: format === "pdf",
        });
        // The body can vanish if the file is closed during the (async) save
        // dialog, even though the pre-dialog guard passed.
        if (prepared == null) return;
        const { html: body, bodyClass } = prepared;

        if (format === "html") {
          const html = buildHtmlDocument({
            bodyHtml: body,
            title: meta.title,
            css: collectStyles(),
            dark: document.documentElement.classList.contains("dark"),
            bodyClass,
          });
          await invoke("write_file", { path, content: html });
        } else if (format === "epub") {
          // Heavy deps (jszip / docx / pdfmake) load only when the user actually
          // exports, keeping them out of the main bundle.
          const { buildEpub } = await import("@/lib/export/epub");
          await writeBinary(
            path,
            await buildEpub({
              bodyHtml: body,
              css: collectStyles(),
              entries,
              bodyClass,
              metadata: {
                title: meta.title,
                author: meta.author,
                language: "en",
                identifier: crypto.randomUUID(),
                modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              },
            }),
          );
        } else if (format === "docx") {
          const { buildDocx } = await import("@/lib/export/docx");
          await writeBinary(
            path,
            await buildDocx(body, { title: meta.title, author: meta.author }),
          );
        } else {
          const { buildPdf } = await import("@/lib/export/pdf");
          await writeBinary(path, await buildPdf(body, { title: meta.title, author: meta.author }));
        }
      } catch (err) {
        console.error(`Failed to export ${format}:`, err);
      } finally {
        setExporting(null);
      }
    },
    [entries, includeToc, filePath, content],
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
