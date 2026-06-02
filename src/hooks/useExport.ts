import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo } from "react";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument } from "@/lib/export/html";
import { deriveExportMeta } from "@/lib/export/meta";
import { prepareContent } from "@/lib/export/prepareContent";
import type { PrintSettings } from "@/lib/settings";
import type { TocEntry } from "./useTableOfContents";

export type ExportFormat = "html" | "docx" | "epub";

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
};

export interface ExportHandlers {
  exportHtml: () => Promise<void>;
  exportDocx: () => Promise<void>;
  exportEpub: () => Promise<void>;
}

/**
 * Export the active document to HTML/DOCX/EPUB. Reuses the rendered
 * `.markdown-body` DOM for fidelity, shows a native save dialog, and writes via
 * Rust commands (text for HTML, bytes for DOCX/EPUB). PDF is handled separately
 * by the print path.
 */
export function useExport({
  entries,
  settings,
  filePath,
  content,
}: UseExportOptions): ExportHandlers {
  const includeToc = settings.includeToc;

  return useMemo(() => {
    const run = async (format: ExportFormat) => {
      const body = await prepareContent({ entries, includeToc });
      if (body == null) return; // nothing rendered to export

      const meta = deriveExportMeta(filePath, content);
      const { name, ext } = FILTERS[format];
      const path = await save({
        defaultPath: `${meta.baseName}.${ext}`,
        filters: [{ name, extensions: [ext] }],
      });
      if (!path) return; // user cancelled

      try {
        if (format === "html") {
          const html = buildHtmlDocument({
            bodyHtml: body,
            title: meta.title,
            css: collectStyles(),
            dark: document.documentElement.classList.contains("dark"),
          });
          await invoke("write_file", { path, content: html });
        } else if (format === "epub") {
          // Heavy deps (jszip / docx) load only when the user actually exports,
          // keeping them out of the main bundle.
          const { buildEpub } = await import("@/lib/export/epub");
          const bytes = await buildEpub({
            bodyHtml: body,
            css: collectStyles(),
            entries,
            metadata: {
              title: meta.title,
              author: meta.author,
              language: "en",
              identifier: crypto.randomUUID(),
              modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            },
          });
          await invoke("write_binary_file", { path, contents: bytes });
        } else {
          const { buildDocx } = await import("@/lib/export/docx");
          const bytes = await buildDocx(body, { title: meta.title, author: meta.author });
          await invoke("write_binary_file", { path, contents: bytes });
        }
      } catch (err) {
        console.error(`Failed to export ${format}:`, err);
      }
    };

    return {
      exportHtml: () => run("html"),
      exportDocx: () => run("docx"),
      exportEpub: () => run("epub"),
    };
  }, [entries, includeToc, filePath, content]);
}
