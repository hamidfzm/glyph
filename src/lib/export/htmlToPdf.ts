import type { Content, TableCell } from "pdfmake/interfaces";
import { decodeSvgDataUrl } from "@/lib/svgDataUrl";
import { decodeDataUri } from "./imageSize";
import { codeRuns, cssColorToHex, inlinePdf } from "./pdfInline";
import { CONTENT_WIDTH, svgNode } from "./svgPdfNode";

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

function imageNode(el: Element): Content | null {
  const src = el.getAttribute("src") ?? "";
  // An SVG image (inlined by prepareContent as a data: URL) embeds as vectors.
  const svgMarkup = decodeSvgDataUrl(src);
  if (svgMarkup !== null) {
    const svgEl = new DOMParser().parseFromString(svgMarkup, "text/html").body.querySelector("svg");
    return svgEl ? svgNode(svgEl) : null;
  }
  const decoded = decodeDataUri(src);
  // pdfmake embeds PNG and JPEG; other raster formats are skipped.
  if (!decoded || (decoded.type !== "png" && decoded.type !== "jpg")) return null;
  const width = Math.min(decoded.width, CONTENT_WIDTH);
  return { image: src, width, margin: [0, 0, 0, 8] };
}

function listItems(listEl: Element): Content[] {
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
      n.tagName.toLowerCase() === "ol" ? { ol: listItems(n) } : { ul: listItems(n) },
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

function blocksForNode(node: Node): Content[] {
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
  if (tag === "ul") return [{ ul: listItems(el), margin: [0, 0, 0, 8] }];
  if (tag === "ol") return [{ ol: listItems(el), margin: [0, 0, 0, 8] }];
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
    // The code block's background and default text color are inlined onto the
    // <pre> by prepareContent (PDF) so the cell matches the active code theme.
    const style = (el as HTMLElement).style;
    const fill = cssColorToHex(style?.backgroundColor) ?? "#f4f4f4";
    const baseColor = cssColorToHex(style?.color);
    return [
      {
        table: {
          widths: ["*"],
          body: [[{ text: codeRuns(el, baseColor), preserveLeadingSpaces: true, fontSize: 9 }]],
        },
        layout: { fillColor: () => fill, hLineWidth: () => 0, vLineWidth: () => 0 },
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
  if (tag === "svg") return [svgNode(el)];
  if (tag === "img") {
    const img = imageNode(el);
    return img ? [img] : [];
  }

  // A note embed (`![[note]]`) renders as a bordered block on screen; mirror
  // that in the PDF by boxing its content in a single-cell table so the embed
  // stays visually distinct rather than flattening into the surrounding text.
  if (tag === "div" && el.classList.contains("markdown-embed")) {
    const inner = Array.from(el.childNodes).flatMap((c) => blocksForNode(c));
    if (inner.length === 0) return [];
    return [
      {
        table: { widths: ["*"], body: [[{ stack: inner }]] },
        layout: {
          hLineWidth: () => 0.75,
          vLineWidth: () => 0.75,
          hLineColor: () => "#d0d0d0",
          vLineColor: () => "#d0d0d0",
          paddingLeft: () => 10,
          paddingRight: () => 10,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        margin: [0, 4, 0, 8],
      },
    ];
  }

  if (CONTAINER_TAGS.has(tag)) {
    return Array.from(el.childNodes).flatMap((c) => blocksForNode(c));
  }

  // Inline-level element at block position (e.g. a bare <span> or KaTeX's
  // `katex-display`): render its inline content so math is reduced to LaTeX
  // rather than recursing into KaTeX's glyph spans.
  const inline = inlinePdf(el);
  return inline.length ? [{ text: inline, margin: [0, 0, 0, 8] }] : [];
}

/**
 * Walk a prepared HTML fragment into a pdfmake content array. Block-level SVG
 * (light-rendered diagrams, SVG images) embeds as vector `svg` nodes; inline
 * math falls back to its LaTeX source, matching the docx walker.
 *
 * Takes either markup or an element already mounted in the live document; a
 * mounted root is what lets diagrams keep their own CSS (see `svgNode`).
 */
export function convertHtmlToPdf(body: string | Element): Content[] {
  const root =
    typeof body === "string" ? new DOMParser().parseFromString(body, "text/html").body : body;
  const out = Array.from(root.childNodes).flatMap((node) => blocksForNode(node));
  return out.length ? out : [{ text: "" }];
}
