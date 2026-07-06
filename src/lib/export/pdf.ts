import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { convertHtmlToPdf } from "./htmlToPdf";
import { pdfEngine } from "./pdfEngine";
import { rasterizeSvgsInHtml } from "./rasterize";

export interface PdfMetadata {
  title: string;
  author?: string;
}

async function renderPdf(bodyHtml: string, meta: PdfMetadata): Promise<Uint8Array> {
  const docDefinition: TDocumentDefinitions = {
    info: { title: meta.title, author: meta.author },
    content: convertHtmlToPdf(bodyHtml),
    defaultStyle: { fontSize: 11, lineHeight: 1.3 },
    pageMargins: [40, 40, 40, 40],
  };

  const buffer = await pdfEngine().createPdf(docDefinition).getBuffer();
  return new Uint8Array(buffer);
}

/**
 * Build a vector PDF from prepared body HTML — selectable text, embedded
 * PNG/JPEG images, real tables and lists, and diagrams/SVG images as true
 * vector `svg` nodes. Math is reduced to its LaTeX source or a raster image
 * (vector math is #256). Produced directly, with no print dialog.
 *
 * pdfmake's SVG renderer (svg-to-pdfkit) can't draw every SVG feature (some
 * filters, CSS, markers), so a failed vector build retries once with every
 * SVG rasterized to PNG — one exotic diagram never sinks the whole export.
 */
export async function buildPdf(bodyHtml: string, meta: PdfMetadata): Promise<Uint8Array> {
  try {
    return await renderPdf(bodyHtml, meta);
  } catch {
    return renderPdf(await rasterizeSvgsInHtml(bodyHtml), meta);
  }
}
