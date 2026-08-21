import { invoke } from "@tauri-apps/api/core";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument } from "@/lib/export/html";
import type { ExportMeta } from "@/lib/export/meta";
import { prepareContent } from "@/lib/export/prepareContent";
import { type ExportFormat, epubMetadata, writeBinary } from "@/lib/export/writeExport";

interface ExportDocumentOptions {
  entries: TocEntry[];
  includeToc: boolean;
  // Bytes of media EPUB may package; every other format names the media instead.
  epubMediaLimit?: number;
}

/**
 * Export the rendered `.markdown-body` document, reusing the live DOM for
 * fidelity. The heavy builders (jszip / docx / pdfmake) are imported here so
 * they load only when the user actually exports.
 */
export async function exportDocument(
  format: ExportFormat,
  path: string,
  meta: ExportMeta,
  { entries, includeToc, epubMediaLimit = 0 }: ExportDocumentOptions,
): Promise<void> {
  const prepared = await prepareContent({
    entries,
    includeToc,
    // PDF needs inlined code colors, rasterized math, and diagrams re-rendered
    // light as inline SVG for vector embedding.
    pdf: format === "pdf",
    mediaLimit: format === "epub" ? epubMediaLimit : 0,
  });
  // The body can vanish if the file is closed during the (async) save dialog,
  // even though the pre-dialog guard passed.
  if (prepared == null) return;
  const { html: body, bodyClass, media } = prepared;

  if (format === "html") {
    const html = buildHtmlDocument({
      bodyHtml: body,
      title: meta.title,
      css: collectStyles(),
      dark: document.documentElement.classList.contains("dark"),
      bodyClass,
    });
    await invoke("write_file", { path, content: html });
    return;
  }

  if (format === "epub") {
    const { buildEpub } = await import("@/lib/export/epub");
    await writeBinary(
      path,
      await buildEpub({
        bodyHtml: body,
        css: collectStyles(),
        entries,
        bodyClass,
        media,
        metadata: epubMetadata(meta.title, meta.author),
      }),
    );
    return;
  }

  if (format === "docx") {
    const { buildDocx } = await import("@/lib/export/docx");
    await writeBinary(path, await buildDocx(body, { title: meta.title, author: meta.author }));
    return;
  }

  const { buildPdf } = await import("@/lib/export/pdf");
  await writeBinary(path, await buildPdf(body, { title: meta.title, author: meta.author }));
}
