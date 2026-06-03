import type { Content, TableCell } from "pdfmake/interfaces";
import { decodeDataUri } from "./imageSize";

// Page content width for an A4 page with default pdfmake margins (~40pt each).
const CONTENT_WIDTH = 515;

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

const STYLE_TAGS: Record<string, keyof InlineStyle> = {
  strong: "bold",
  b: "bold",
  em: "italics",
  i: "italics",
  del: "strike",
  s: "strike",
  strike: "strike",
};

const HEADING_SIZES: Record<string, number> = { h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11 };

// Block-level wrappers whose children are themselves blocks. Anything else that
// reaches the fallback (spans, KaTeX's `katex-display`, etc.) is inline-level
// and must go through inlinePdf so math is extracted rather than its rendered
// glyph spans being dumped as paragraphs.
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

function styledText(text: string, style: InlineStyle): Content {
  if (!style.bold && !style.italics && !style.strike) return text;
  return {
    text,
    bold: style.bold,
    italics: style.italics,
    decoration: style.strike ? "lineThrough" : undefined,
  };
}

// Flatten an element's inline descendants into pdfmake text fragments. Anchors
// become links; `<br>` becomes a newline; KaTeX falls back to its LaTeX source;
// raw SVG (Mermaid) is skipped. Inline images degrade to their alt text — block
// images are handled separately and embedded.
function inlinePdf(node: Node, style: InlineStyle = {}): Content[] {
  const out: Content[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      // Text nodes from parsed HTML are never empty; push directly.
      out.push(styledText((child as Text).data, style));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (el.classList.contains("katex")) {
      const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
      // textContent is never null for an element, so no empty-string fallback.
      const tex = (annotation?.textContent ?? el.textContent!).trim();
      if (tex) out.push({ text: tex, italics: true });
      continue;
    }
    if (tag === "svg") continue;
    if (tag === "br") {
      out.push("\n");
      continue;
    }
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt) out.push({ text: alt, italics: true });
      continue;
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      // Only real external links become clickable PDF links. pdfmake renders a
      // link most reliably on a single text leaf, so use the anchor's label
      // (its child icon SVG contributes no text). In-page/relative links just
      // render as their inline content.
      if (/^https?:/i.test(href)) {
        // textContent is never null for an element; fall back to the URL when
        // the link has no visible label.
        const label = el.textContent!.trim() || href;
        out.push({ text: label, link: href, color: "#1a56db", decoration: "underline" });
      } else {
        out.push(...inlinePdf(el, style));
      }
      continue;
    }
    const styleKey = STYLE_TAGS[tag];
    out.push(...inlinePdf(el, styleKey ? { ...style, [styleKey]: true } : style));
  }
  return out;
}

function imageNode(el: Element): Content | null {
  const src = el.getAttribute("src") ?? "";
  const decoded = decodeDataUri(src);
  // pdfmake embeds PNG and JPEG; other formats are skipped.
  if (!decoded || (decoded.type !== "png" && decoded.type !== "jpg")) return null;
  const width = Math.min(decoded.width, CONTENT_WIDTH);
  return { image: src, width, margin: [0, 0, 0, 8] };
}

function listItems(listEl: Element, ctx: Ctx): Content[] {
  const items: Content[] = [];
  for (const li of Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === "li")) {
    const clone = li.cloneNode(true) as Element;
    for (const sub of Array.from(clone.children)) {
      if (/^(ul|ol)$/i.test(sub.tagName)) sub.remove();
    }
    const text: Content = { text: inlinePdf(clone) };
    const nested = Array.from(li.children).filter((c) => /^(ul|ol)$/i.test(c.tagName));
    if (nested.length === 0) {
      items.push(text);
      continue;
    }
    const sublists = nested.map((n) =>
      n.tagName.toLowerCase() === "ol" ? { ol: listItems(n, ctx) } : { ul: listItems(n, ctx) },
    );
    items.push({ stack: [text, ...sublists] });
  }
  return items;
}

function tableNode(el: Element): Content {
  const rows = Array.from(el.querySelectorAll("tr"));
  const body: TableCell[][] = [];
  let headerRows = 0;
  rows.forEach((tr, i) => {
    const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
    if (cells.length === 0) return;
    const isHeader = cells.every((c) => c.tagName.toLowerCase() === "th");
    if (isHeader && i === 0) headerRows = 1;
    body.push(cells.map((cell) => ({ text: inlinePdf(cell), bold: isHeader })));
  });
  const columns = body[0]?.length ?? 1;
  return {
    table: { headerRows, widths: Array.from({ length: columns }, () => "*"), body },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 8],
  };
}

interface Ctx {
  // reserved for future nesting state; kept for symmetry with the docx walker
  depth: number;
}

function blocksForNode(node: Node, ctx: Ctx): Content[] {
  if (node.nodeType === 3) {
    const text = (node as Text).data.trim();
    return text ? [{ text, margin: [0, 0, 0, 8] }] : [];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (HEADING_SIZES[tag]) {
    return [
      { text: inlinePdf(el), fontSize: HEADING_SIZES[tag], bold: true, margin: [0, 8, 0, 4] },
    ];
  }
  if (tag === "p") {
    // A paragraph whose sole content is an image (the common `![](src)` case)
    // becomes a block image. Mixed text+image paragraphs fall through to the
    // inline path, where the image degrades to its alt text.
    const onlyImg =
      el.children.length === 1 &&
      el.children[0].tagName.toLowerCase() === "img" &&
      // textContent is never null for an element.
      !el.textContent!.trim();
    if (onlyImg) {
      const img = imageNode(el.children[0]);
      return img ? [img] : [];
    }
    const text = inlinePdf(el);
    return text.length ? [{ text, margin: [0, 0, 0, 8] }] : [];
  }
  if (tag === "ul") return [{ ul: listItems(el, ctx), margin: [0, 0, 0, 8] }];
  if (tag === "ol") return [{ ol: listItems(el, ctx), margin: [0, 0, 0, 8] }];
  if (tag === "blockquote") {
    const paras = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "p");
    const sources = paras.length > 0 ? paras : [el];
    return sources.map((p) => ({
      text: inlinePdf(p),
      italics: true,
      color: "#555555",
      margin: [16, 0, 0, 8],
    }));
  }
  if (tag === "pre") {
    const code = el.textContent!.replace(/\n$/, "");
    return [
      {
        table: {
          widths: ["*"],
          body: [[{ text: code, preserveLeadingSpaces: true, fontSize: 9 }]],
        },
        layout: { fillColor: () => "#f4f4f4", hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 0, 0, 8],
      },
    ];
  }
  if (tag === "hr") {
    return [
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 3,
            x2: CONTENT_WIDTH,
            y2: 3,
            lineWidth: 0.5,
            lineColor: "#cccccc",
          },
        ],
        margin: [0, 4, 0, 8],
      },
    ];
  }
  if (tag === "table") return [tableNode(el)];
  if (tag === "svg") return [];
  if (tag === "img") {
    const img = imageNode(el);
    return img ? [img] : [];
  }

  if (CONTAINER_TAGS.has(tag)) {
    return Array.from(el.childNodes).flatMap((c) => blocksForNode(c, ctx));
  }

  // Inline-level element at block position (e.g. a bare <span> or KaTeX's
  // `katex-display`): render its inline content so math is reduced to LaTeX
  // rather than recursing into KaTeX's glyph spans.
  const inline = inlinePdf(el);
  return inline.length ? [{ text: inline, margin: [0, 0, 0, 8] }] : [];
}

/**
 * Walk a prepared HTML fragment into a pdfmake content array. Reuses the docx
 * walker's structure and fidelity tradeoffs: math becomes LaTeX source and SVG
 * diagrams are dropped, since a vector PDF has no faithful equivalent.
 */
export function convertHtmlToPdf(bodyHtml: string): Content[] {
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  const ctx: Ctx = { depth: 0 };
  const out = Array.from(doc.body.childNodes).flatMap((node) => blocksForNode(node, ctx));
  return out.length ? out : [{ text: "" }];
}
