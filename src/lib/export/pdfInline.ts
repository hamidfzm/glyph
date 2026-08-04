// Inline-level HTML to pdfmake conversion: bold/italic/strike runs, links,
// inline math, and the colour helpers the block walker and the canvas exporter
// share. Block-level conversion lives in htmlToPdf.ts.

import type { Content } from "pdfmake/interfaces";

export interface InlineStyle {
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

export function styledText(text: string, style: InlineStyle): Content {
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
// an SVG at inline position is skipped (block-level SVG embeds as a vector
// node). Inline images degrade to their alt text — block images are handled
// separately and embedded.
export function inlinePdf(node: Node, style: InlineStyle = {}): Content[] {
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

// Convert a computed CSS color (`rgb()/rgba()`) to the hex pdfmake expects.
// Hex/named values pass through; fully transparent resolves to undefined.
export function cssColorToHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(color);
  if (!m) return color;
  if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

// Flatten a highlighted <pre> into colored text runs, carrying each span's
// inlined syntax-highlight color (set by prepareContent for PDF export) down
// the tree and preserving newlines. The trailing newline is dropped.
export function codeRuns(pre: Element, baseColor?: string): Content[] {
  const runs: Content[] = [];
  const walk = (node: Node, color?: string) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = (child as Text).data;
        runs.push(color ? { text, color } : { text });
      } else if (child.nodeType === 1) {
        const el = child as HTMLElement;
        walk(el, cssColorToHex(el.style?.color) ?? color);
      }
    }
  };
  walk(pre, baseColor);
  const last = runs[runs.length - 1] as { text?: string } | undefined;
  if (last && typeof last.text === "string") {
    last.text = last.text.replace(/\n$/, "");
    if (!last.text) runs.pop();
  }
  return runs.length ? runs : [{ text: "" }];
}
