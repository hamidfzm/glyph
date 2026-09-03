import type { TocEntry } from "@/hooks/useTableOfContents";
import type { CliExportRequest } from "@/lib/cliExport";
import { exportDocument } from "@/lib/export/exportDocument";
import { deriveExportMeta } from "@/lib/export/meta";
import { waitForRenderIdle } from "@/lib/export/renderReady";
import type { ExportFormat } from "@/lib/export/writeExport";

interface CliDocumentExportOptions {
  entries: TocEntry[];
  includeToc: boolean;
  content: string | null;
  epubMediaLimit: number;
}

/**
 * Run a `glyph export <file> --format <format>` request against the document the
 * hidden window has open. Goes through the same `exportDocument` the menu uses,
 * so CLI output matches interactive output: inlined code colors, rasterized
 * math, and light-theme vector diagrams all come from the live DOM.
 *
 * Returns the path written and whether the document had finished rendering, so
 * a timed-out export reports itself rather than passing off a document with
 * missing diagrams as a complete one.
 */
export async function runCliDocumentExport(
  request: CliExportRequest,
  // Read after the wait, not before: on a CLI launch the document is still
  // being opened when the export starts, so a snapshot taken now would carry
  // an empty table of contents and no content to derive the title from.
  getOptions: () => CliDocumentExportOptions,
): Promise<{ path: string; settled: boolean }> {
  // Diagrams and math finish rendering after mount; exporting before they
  // settle writes empty slots.
  const { settled } = await waitForRenderIdle();
  // `exportDocument` no-ops when there is no rendered body, which would report
  // a success that wrote no file.
  if (!document.querySelector(".markdown-body, .notebook-body")) {
    throw new Error(`${request.input} did not finish rendering`);
  }
  const { entries, includeToc, content, epubMediaLimit } = getOptions();
  const meta = deriveExportMeta(request.input, content);
  await exportDocument(request.format as ExportFormat, request.output, meta, {
    entries,
    includeToc,
    epubMediaLimit,
  });
  return { path: request.output, settled };
}
