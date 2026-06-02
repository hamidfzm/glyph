import { AlignmentType, Document, LevelFormat, Packer } from "docx";
import { convertHtmlToDocx, OL_REFERENCE } from "./htmlToDocx";

export interface DocxMetadata {
  title: string;
  author?: string;
}

// Decimal numbering for ordered lists, indented per nesting level. Bulleted
// lists use docx's built-in bullets and need no config.
const NUMBERING = {
  config: [
    {
      reference: OL_REFERENCE,
      levels: Array.from({ length: 5 }, (_, level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
      })),
    },
  ],
};

/**
 * Build a `.docx` from prepared body HTML. Headings, lists, tables, quotes,
 * code, links, and inline formatting are preserved. Math is reduced to its
 * LaTeX source and diagrams (SVG) are dropped — DOCX has no faithful equivalent.
 */
export async function buildDocx(bodyHtml: string, meta: DocxMetadata): Promise<Uint8Array> {
  const doc = new Document({
    title: meta.title,
    creator: meta.author || "Glyph",
    numbering: NUMBERING,
    sections: [{ children: convertHtmlToDocx(bodyHtml) }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
