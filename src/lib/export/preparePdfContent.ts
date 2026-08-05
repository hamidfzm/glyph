// The extra passes a PDF export needs that the vector walker cannot do itself:
// diagrams re-rendered light as inline SVG, block math rasterized to an image,
// right-to-left blocks rasterized (pdfmake does no bidi shaping), and
// syntax-highlight colours inlined onto code spans. Applied to the export
// clone by prepareContent.

import { renderD2 } from "@/lib/d2Render";
import { containsRtlText } from "@/lib/textDirection";
import { rasterizeElement, renderMermaidLightSvg, restoreMermaidTheme } from "./rasterize";

// For PDF export: swap each Mermaid / D2 diagram in the clone for its
// light-theme vector `<svg>` (the walker embeds SVG natively; see htmlToPdf),
// and rasterize block math (`.katex-display`) to a PNG <img> (vector math is
// #256). Diagrams re-render light so they don't sit as a dark box on the white
// page. A math failure leaves the original node (the walker falls back to the
// LaTeX source); a diagram whose light re-render fails is removed so the dark
// on-screen SVG never leaks into the PDF.
export async function preparePdfRichContent(liveBody: Element, clone: Element): Promise<void> {
  const selector = ".katex-display, .mermaid-diagram, .d2-diagram";
  const live = liveBody.querySelectorAll<HTMLElement>(selector);
  if (live.length === 0) return;
  const cloned = clone.querySelectorAll(selector);
  const mathBackground = getComputedStyle(liveBody).backgroundColor || "#ffffff";
  let mermaidRendered = false;

  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    const isMath = el.classList.contains("katex-display");
    try {
      if (isMath) {
        const img = clone.ownerDocument.createElement("img");
        img.setAttribute("src", await rasterizeElement(el, mathBackground));
        cloned[i].replaceWith(img);
        continue;
      }
      const isMermaid = el.classList.contains("mermaid-diagram");
      const source = el.getAttribute(isMermaid ? "data-mermaid-source" : "data-d2-source");
      if (!source) continue; // no source to re-render; the on-screen SVG embeds as-is
      const svg = isMermaid ? await renderMermaidLightSvg(source) : await renderD2(source, false);
      if (isMermaid) mermaidRendered = true;
      const wrap = clone.ownerDocument.createElement("div");
      // The diagram source is user-authored, and unlike D2 (sanitized in
      // d2Render) Mermaid's output is raw, so sanitize at the sink before it
      // re-enters the DOM and later flows into pdfmake's SVG parser. DOMPurify
      // keeps <style> blocks and style attributes, which Mermaid's colors need;
      // <foreignObject> is forbidden as the SVG-embedded-HTML vector (and
      // pdfmake can't draw it anyway).
      const { default: DOMPurify } = await import("dompurify");
      wrap.innerHTML = DOMPurify.sanitize(svg, { FORBID_TAGS: ["foreignObject"] });
      const svgEl = wrap.querySelector("svg");
      if (!svgEl) throw new Error("no svg in rendered diagram");
      cloned[i].replaceWith(svgEl);
    } catch {
      if (!isMath) cloned[i].remove();
    }
  }

  if (mermaidRendered) {
    await restoreMermaidTheme(liveBody.ownerDocument.documentElement.classList.contains("dark"));
  }
}

// pdfmake positions each word individually left-to-right and does no bidi
// reordering or Arabic shaping (and its bundled font has no Arabic/Hebrew
// glyphs), so RTL text can't render as PDF text. Instead, any block containing
// RTL characters is captured from the live DOM as an image, the same treatment
// block math gets: the webview's bidi rendering is exact. Outermost matching
// blocks only, so a list with one RTL item rasterizes once. Code blocks are
// not candidates and stay selectable text.
const RTL_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table";

export async function rasterizeRtlBlocks(liveBody: Element, clone: Element): Promise<void> {
  const live = liveBody.querySelectorAll<HTMLElement>(RTL_BLOCK_SELECTOR);
  if (live.length === 0) return;
  const cloned = clone.querySelectorAll(RTL_BLOCK_SELECTOR);
  const background = getComputedStyle(liveBody).backgroundColor || "#ffffff";
  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    // Skip nested matches (an RTL <li> is covered by its list, a table cell's
    // paragraph by its table).
    if (el.parentElement?.closest(RTL_BLOCK_SELECTOR)) continue;
    if (!containsRtlText(el.textContent)) continue;
    try {
      const img = clone.ownerDocument.createElement("img");
      img.setAttribute("src", await rasterizeElement(el, background));
      cloned[i].replaceWith(img);
    } catch {
      // Leave the original block; the walker degrades to logical-order text.
    }
  }
}

// Copy the live computed text color of each highlighted code span onto the
// matching clone span as an inline style. The clone is detached, so the PDF
// walker can't compute styles itself — it reads these inline colors instead.
export function inlineCodeColors(liveBody: Element, clone: Element): void {
  // Per-token colors. The clone is a deep copy, so the node lists line up.
  const liveSpans = liveBody.querySelectorAll("pre code span");
  const cloneSpans = clone.querySelectorAll("pre code span");
  liveSpans.forEach((span, i) => {
    (cloneSpans[i] as HTMLElement).style.color = getComputedStyle(span).color;
  });
  // Block background + default text color, so the PDF cell matches the theme.
  // The themed background is on <pre> (code has `background: none`); the code
  // theme's base text color is on <code>.
  const livePres = liveBody.querySelectorAll("pre");
  const clonePres = clone.querySelectorAll("pre");
  livePres.forEach((pre, i) => {
    const target = clonePres[i] as HTMLElement;
    target.style.backgroundColor = getComputedStyle(pre).backgroundColor;
    target.style.color = getComputedStyle(pre.querySelector("code") ?? pre).color;
  });
}
