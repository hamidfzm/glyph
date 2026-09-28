// The extra passes a PDF export needs that the vector walker cannot do itself:
// diagrams re-rendered light as inline SVG, block math rasterized to an image,
// right-to-left blocks rasterized (pdfmake does no bidi shaping), and
// syntax-highlight colours inlined onto code spans. Applied to the export
// clone by prepareContent.

import { staticRendererFor } from "@/lib/plugins/staticRenderers";
import { containsRtlText } from "@/lib/textDirection";
import { rasterizeElement } from "./rasterize";

// For PDF export: swap each plugin block (Mermaid, D2) in the clone for its
// light static render (the walker embeds SVG natively; see htmlToPdf), and
// rasterize block math (`.katex-display`) to a PNG <img> (vector math is
// #256). Diagrams re-render light so they don't sit as a dark box on the white
// page. A math failure leaves the original node (the walker falls back to the
// LaTeX source); a block whose static render fails becomes its source, so the
// dark on-screen SVG never leaks into the PDF.
export async function preparePdfRichContent(liveBody: Element, clone: Element): Promise<void> {
  const selector = ".katex-display, [data-fenced-language]";
  const live = liveBody.querySelectorAll<HTMLElement>(selector);
  if (live.length === 0) return;
  const cloned = clone.querySelectorAll(selector);
  const mathBackground = getComputedStyle(liveBody).backgroundColor || "#ffffff";

  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    const pluginLanguage = el.dataset.fencedLanguage;
    if (pluginLanguage !== undefined) {
      const renderStatic = staticRendererFor(pluginLanguage);
      // Without a static render the live block embeds as it is on screen.
      if (!renderStatic) continue;
      const source = el.dataset.fencedSource ?? "";
      // The wrapper keeps the marker, so the RTL pass skips plugin output on
      // both sides and its live/clone node lists still line up.
      const wrap = clone.ownerDocument.createElement("div");
      wrap.setAttribute("data-fenced-language", pluginLanguage);
      try {
        const markup = await renderStatic(source);
        const { default: DOMPurify } = await import("dompurify");
        wrap.innerHTML = DOMPurify.sanitize(markup, { FORBID_TAGS: ["foreignObject"] });
      } catch {
        // Never the dark live render, never nothing: the block's source.
        const pre = clone.ownerDocument.createElement("pre");
        const code = clone.ownerDocument.createElement("code");
        code.textContent = source;
        pre.append(code);
        wrap.replaceChildren(pre);
      }
      cloned[i].replaceWith(wrap);
      continue;
    }
    try {
      const img = clone.ownerDocument.createElement("img");
      img.setAttribute("src", await rasterizeElement(el, mathBackground));
      cloned[i].replaceWith(img);
    } catch {
      // Leave the math node; the walker falls back to the LaTeX source.
    }
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

// Plugin blocks are excluded on both sides: their clone may hold a static
// render with a different shape than the live one.
function rtlCandidates<T extends Element>(root: Element): T[] {
  return Array.from(root.querySelectorAll<T>(RTL_BLOCK_SELECTOR)).filter(
    (el) => !el.closest("[data-fenced-language]"),
  );
}

export async function rasterizeRtlBlocks(liveBody: Element, clone: Element): Promise<void> {
  const live = rtlCandidates<HTMLElement>(liveBody);
  if (live.length === 0) return;
  const cloned = rtlCandidates(clone);
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
