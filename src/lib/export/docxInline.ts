import { ExternalHyperlink, ImageRun, type ParagraphChild, TextRun } from "docx";
import { decodeDataUri } from "./imageSize";

export interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

const MONOSPACE = "Courier New";
// Cap embedded picture width so wide screenshots don't overflow the page; the
// height scales to preserve aspect ratio.
const MAX_IMAGE_WIDTH = 600;

function imageRun(el: Element): ParagraphChild | null {
  const decoded = decodeDataUri(el.getAttribute("src") ?? "");
  if (!decoded) return null;
  const scale = Math.min(1, MAX_IMAGE_WIDTH / decoded.width);
  return new ImageRun({
    type: decoded.type,
    data: decoded.data,
    transformation: {
      width: Math.round(decoded.width * scale),
      height: Math.round(decoded.height * scale),
    },
  });
}

function textRun(text: string, style: InlineStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? MONOSPACE : undefined,
  });
}

const STYLE_TAGS: Record<string, keyof InlineStyle> = {
  strong: "bold",
  b: "bold",
  em: "italics",
  i: "italics",
  del: "strike",
  s: "strike",
  strike: "strike",
  code: "code",
};

/**
 * Flatten an element's inline descendants into docx runs, carrying bold/italic/
 * strike/code formatting down the tree. Anchors become hyperlinks, `<br>`
 * becomes a line break, and inline images embed when decodable (else their alt
 * text). Unknown inline tags pass through as plain styled text.
 */
export function inlineRuns(node: Node, style: InlineStyle = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      const text = (child as Text).data;
      if (text) runs.push(textRun(text, style));
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    // DOCX has no math/vector support here. For KaTeX, emit the original LaTeX
    // source (from its MathML annotation) as monospace rather than the
    // duplicated MathML+HTML text the markup would otherwise flatten to. Skip
    // raw SVG (e.g. Mermaid) entirely — it has no useful text.
    if (el.classList.contains("katex")) {
      const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
      // textContent is never null for an element, so no empty-string fallback.
      const tex = (annotation?.textContent ?? el.textContent!).trim();
      if (tex) runs.push(textRun(tex, { ...style, code: true }));
      continue;
    }
    if (tag === "svg") continue;

    if (tag === "br") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === "img") {
      const run = imageRun(el);
      runs.push(run ?? textRun(el.getAttribute("alt") ?? "", { ...style, italics: true }));
      continue;
    }
    if (tag === "a") {
      const href = el.getAttribute("href");
      const children = inlineRuns(el, style);
      if (href) {
        runs.push(new ExternalHyperlink({ children, link: href }));
      } else {
        runs.push(...children);
      }
      continue;
    }

    const styleKey = STYLE_TAGS[tag];
    runs.push(...inlineRuns(el, styleKey ? { ...style, [styleKey]: true } : style));
  }
  return runs;
}
