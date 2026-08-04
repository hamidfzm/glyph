import { invoke } from "@tauri-apps/api/core";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument } from "@/lib/export/html";
import type { ExportMeta } from "@/lib/export/meta";
import { type ExportFormat, epubMetadata, writeBinary } from "@/lib/export/writeExport";

/**
 * Export the open canvas board. HTML and PDF keep the spatial board 1:1 (HTML
 * via the app stylesheet, PDF via vector primitives on a board-sized page);
 * DOCX and EPUB are flowing documents, so the cards are linearised in board
 * order. Nothing is ever rasterised.
 *
 * The heavy builders (jszip / docx / pdfmake) are imported here so they load
 * only when the user actually exports.
 */
export async function exportCanvas(
  format: ExportFormat,
  path: string,
  meta: ExportMeta,
): Promise<void> {
  const { buildCanvasBoardHtml, buildCanvasDocumentHtml } = await import("@/lib/canvas/exportDoc");

  if (format === "html") {
    const body = await buildCanvasBoardHtml();
    if (body == null) return;
    const html = buildHtmlDocument({
      bodyHtml: body,
      title: meta.title,
      css: collectStyles(),
      dark: document.documentElement.classList.contains("dark"),
      bodyClass: "glyph-canvas-page",
    });
    await invoke("write_file", { path, content: html });
    return;
  }

  if (format === "pdf") {
    const { buildCanvasBoardModel } = await import("@/lib/canvas/exportModel");
    const model = await buildCanvasBoardModel();
    if (model == null) return;
    const { buildCanvasPdf } = await import("@/lib/export/canvasPdf");
    await writeBinary(
      path,
      await buildCanvasPdf(model, { title: meta.title, author: meta.author }),
    );
    return;
  }

  const body = await buildCanvasDocumentHtml();
  if (body == null) return;
  if (format === "epub") {
    const { buildEpub } = await import("@/lib/export/epub");
    await writeBinary(
      path,
      await buildEpub({
        bodyHtml: body,
        css: collectStyles(),
        entries: [],
        metadata: epubMetadata(meta.title, meta.author),
      }),
    );
    return;
  }
  const { buildDocx } = await import("@/lib/export/docx");
  await writeBinary(path, await buildDocx(body, { title: meta.title, author: meta.author }));
}
