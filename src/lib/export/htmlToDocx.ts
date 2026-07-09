import {
  HeadingLevel,
  type IParagraphOptions,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { inlineRuns } from "./docxInline";

export const OL_REFERENCE = "glyph-ordered";
const MONOSPACE = "Courier New";
const INDENT_STEP = 720; // twips (0.5in) per nesting/quote level

type Block = Paragraph | Table;

interface Ctx {
  // Each ordered list gets a fresh numbering instance so it restarts at 1.
  olInstance: number;
}

const HEADING_BY_TAG: Record<string, IParagraphOptions["heading"]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "figure",
  "nav",
  "header",
  "footer",
  "main",
  "details",
]);

function childElements(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}

function codeBlock(el: Element): Paragraph {
  // textContent is never null for an element; the assertion avoids a dead branch.
  const lines = el.textContent!.replace(/\n$/, "").split("\n");
  const children: ParagraphChild[] = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push(new TextRun({ break: 1 }));
    children.push(new TextRun({ text: line, font: MONOSPACE }));
  });
  return new Paragraph({ children, shading: { fill: "F2F2F2" } });
}

function quoteBlocks(el: Element): Block[] {
  const paras = childElements(el, "p");
  const sources = paras.length > 0 ? paras : [el];
  return sources.map(
    (p) => new Paragraph({ indent: { left: INDENT_STEP }, children: inlineRuns(p) }),
  );
}

function tableBlock(el: Element): Table {
  const rows: TableRow[] = [];
  for (const tr of Array.from(el.querySelectorAll("tr"))) {
    const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
    if (cells.length === 0) continue;
    rows.push(
      new TableRow({
        children: cells.map((cell) => {
          const header = cell.tagName.toLowerCase() === "th";
          return new TableCell({
            children: [new Paragraph({ children: inlineRuns(cell, { bold: header }) })],
          });
        }),
      }),
    );
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

// A note embed (`![[note]]`) is a bordered block on screen; render it as a
// single-cell table so the embedded content stays boxed rather than flattening
// into the surrounding document.
function embedBlock(el: Element, ctx: Ctx): Table {
  const inner = Array.from(el.childNodes).flatMap((c) => blocksForNode(c, ctx));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [new TableCell({ children: inner.length ? inner : [new Paragraph({})] })],
      }),
    ],
  });
}

function listBlocks(listEl: Element, ordered: boolean, level: number, ctx: Ctx): Block[] {
  const out: Block[] = [];
  const instance = ordered ? ctx.olInstance++ : 0;
  for (const li of childElements(listEl, "li")) {
    const nested: Element[] = [];
    const clone = li.cloneNode(true) as Element;
    for (const sub of Array.from(clone.children)) {
      const t = sub.tagName.toLowerCase();
      if (t === "ul" || t === "ol") sub.remove();
    }
    for (const sub of Array.from(li.children)) {
      const t = sub.tagName.toLowerCase();
      if (t === "ul" || t === "ol") nested.push(sub);
    }
    const listProps: IParagraphOptions = ordered
      ? { numbering: { reference: OL_REFERENCE, level, instance } }
      : { bullet: { level } };
    out.push(new Paragraph({ ...listProps, children: inlineRuns(clone) }));
    for (const sublist of nested) {
      out.push(...listBlocks(sublist, sublist.tagName.toLowerCase() === "ol", level + 1, ctx));
    }
  }
  return out;
}

function blocksForNode(node: Node, ctx: Ctx): Block[] {
  if (node.nodeType === 3) {
    const text = (node as Text).data.trim();
    return text ? [new Paragraph({ children: [new TextRun(text)] })] : [];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (HEADING_BY_TAG[tag]) {
    return [new Paragraph({ heading: HEADING_BY_TAG[tag], children: inlineRuns(el) })];
  }
  if (tag === "p") {
    const children = inlineRuns(el);
    return children.length ? [new Paragraph({ children })] : [];
  }
  if (tag === "ul" || tag === "ol") return listBlocks(el, tag === "ol", 0, ctx);
  if (tag === "blockquote") return quoteBlocks(el);
  if (tag === "pre") return [codeBlock(el)];
  if (tag === "hr") return [new Paragraph({ thematicBreak: true })];
  if (tag === "table") return [tableBlock(el)];
  if (tag === "svg") return [];
  if (tag === "div" && el.classList.contains("markdown-embed")) return [embedBlock(el, ctx)];

  if (CONTAINER_TAGS.has(tag)) {
    return Array.from(el.childNodes).flatMap((c) => blocksForNode(c, ctx));
  }

  // Unknown element: render its inline content as a paragraph.
  const children = inlineRuns(el);
  return children.length ? [new Paragraph({ children })] : [];
}

/**
 * Walk a prepared HTML fragment into docx blocks (paragraphs and tables),
 * preserving headings, lists, quotes, code, tables, links, and inline
 * formatting. Always returns at least one block so the document is non-empty.
 */
export function convertHtmlToDocx(bodyHtml: string): Block[] {
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  const ctx: Ctx = { olInstance: 1 };
  const out = Array.from(doc.body.childNodes).flatMap((node) => blocksForNode(node, ctx));
  return out.length ? out : [new Paragraph({})];
}
