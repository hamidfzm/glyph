import pdfMake from "pdfmake/build/pdfmake";
import vfs from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { convertHtmlToPdf } from "./htmlToPdf";

export interface PdfMetadata {
  title: string;
  author?: string;
}

let vfsRegistered = false;

/**
 * Build a vector PDF from prepared body HTML — selectable text, embedded
 * PNG/JPEG images, real tables and lists. Math is reduced to its LaTeX source
 * and SVG diagrams are dropped (a vector PDF has no faithful equivalent), the
 * same tradeoffs as the DOCX export. Produced directly, with no print dialog.
 */
export async function buildPdf(bodyHtml: string, meta: PdfMetadata): Promise<Uint8Array> {
  if (!vfsRegistered) {
    pdfMake.addVirtualFileSystem(vfs);
    vfsRegistered = true;
  }

  const docDefinition: TDocumentDefinitions = {
    info: { title: meta.title, author: meta.author },
    content: convertHtmlToPdf(bodyHtml),
    defaultStyle: { fontSize: 11, lineHeight: 1.3 },
    pageMargins: [40, 40, 40, 40],
  };

  const buffer = await pdfMake.createPdf(docDefinition).getBuffer();
  return new Uint8Array(buffer);
}
