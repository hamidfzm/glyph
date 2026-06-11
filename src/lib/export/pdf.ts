import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { convertHtmlToPdf } from "./htmlToPdf";
import { pdfEngine } from "./pdfEngine";

export interface PdfMetadata {
  title: string;
  author?: string;
}

/**
 * Build a vector PDF from prepared body HTML — selectable text, embedded
 * PNG/JPEG images, real tables and lists. Math is reduced to its LaTeX source
 * and SVG diagrams are dropped (a vector PDF has no faithful equivalent), the
 * same tradeoffs as the DOCX export. Produced directly, with no print dialog.
 */
export async function buildPdf(bodyHtml: string, meta: PdfMetadata): Promise<Uint8Array> {
  const docDefinition: TDocumentDefinitions = {
    info: { title: meta.title, author: meta.author },
    content: convertHtmlToPdf(bodyHtml),
    defaultStyle: { fontSize: 11, lineHeight: 1.3 },
    pageMargins: [40, 40, 40, 40],
  };

  const buffer = await pdfEngine().createPdf(docDefinition).getBuffer();
  return new Uint8Array(buffer);
}
