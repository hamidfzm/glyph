// Spatial vector PDF of a canvas board. One custom-sized page reproduces the
// board layout: groups and cards as rounded vector rectangles, edges (with
// arrowheads and labels) as an embedded svg, and each card's markdown
// converted to real selectable text placed at the card's position. CSS pixels
// map 1:1 to PDF points — the page is simply as large as the board.

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { CanvasBoardModel } from "@/lib/canvas/exportModel";
import { convertHtmlToPdf, cssColorToHex } from "./htmlToPdf";
import type { PdfMetadata } from "./pdf";
import { pdfEngine } from "./pdfEngine";

/** Mirrors the on-screen card content padding (canvas.css: 10px 14px). */
const CARD_PAD_X = 14;
const CARD_PAD_Y = 10;
const LINK_COLOR = "#0a84ff";

function rect(card: {
  x: number;
  y: number;
  width: number;
  height: number;
  borderColor: string;
  background: string;
  kind: "group" | "card";
}): Content {
  return {
    canvas: [
      {
        type: "rect",
        x: 0,
        y: 0,
        w: card.width,
        h: card.height,
        r: card.kind === "group" ? 12 : 10,
        lineWidth: 1,
        lineColor: cssColorToHex(card.borderColor) ?? "#c8c8cd",
        color: cssColorToHex(card.background) ?? (card.kind === "group" ? "#f2f2f4" : "#ffffff"),
      },
    ],
    absolutePosition: { x: card.x, y: card.y },
  };
}

/** A width-constrained block at an absolute page position. */
function placed(x: number, y: number, width: number, stack: Content[]): Content {
  return {
    columns: [{ width, stack }],
    absolutePosition: { x, y },
  };
}

export async function buildCanvasPdf(
  model: CanvasBoardModel,
  meta: PdfMetadata,
): Promise<Uint8Array> {
  const content: Content[] = [];

  // Paint order matches the board: groups behind, then edges, then cards.
  const groups = model.cards.filter((c) => c.kind === "group");
  const cards = model.cards.filter((c) => c.kind === "card");

  for (const group of groups) {
    content.push(rect(group));
    if (group.label) {
      content.push(
        placed(group.x + 10, group.y + 7, group.width - 20, [
          { text: group.label, fontSize: 8, color: "#8e8e93", bold: true },
        ]),
      );
    }
  }

  content.push({
    svg: model.edgesSvg,
    width: model.width,
    absolutePosition: { x: 0, y: 0 },
  });

  for (const card of cards) {
    content.push(rect(card));
    const innerWidth = card.width - CARD_PAD_X * 2;
    if (card.html) {
      content.push(
        placed(card.x + CARD_PAD_X, card.y + CARD_PAD_Y, innerWidth, convertHtmlToPdf(card.html)),
      );
    } else if (card.linkUrl) {
      content.push(
        placed(card.x + CARD_PAD_X, card.y + CARD_PAD_Y, innerWidth, [
          { text: card.linkUrl, link: card.linkUrl, color: LINK_COLOR },
        ]),
      );
    } else if (card.fileName) {
      content.push(
        placed(card.x + CARD_PAD_X, card.y + CARD_PAD_Y, innerWidth, [
          { text: card.fileName, italics: true },
        ]),
      );
    }
  }

  const docDefinition: TDocumentDefinitions = {
    info: { title: meta.title, author: meta.author },
    pageSize: { width: model.width, height: model.height },
    pageMargins: [0, 0, 0, 0],
    content,
    // Card text renders at ~87.5% of the document size on the board; PDF
    // points are slightly larger than CSS pixels, so 8.5pt lands close.
    defaultStyle: { fontSize: 8.5, lineHeight: 1.25 },
  };

  const buffer = await pdfEngine().createPdf(docDefinition).getBuffer();
  return new Uint8Array(buffer);
}
