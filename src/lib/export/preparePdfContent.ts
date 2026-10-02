// The extra passes a PDF export needs that the vector walker cannot do itself:
// diagrams re-rendered light as inline SVG, block math rasterized to an image,
// blocks with right-to-left text or inline math rasterized (pdfmake does no
// bidi shaping and has no inline images), and syntax-highlight colours inlined
// onto code spans. Applied to the export clone by prepareContent.

import { staticRendererFor } from "@/lib/plugins/staticRenderers";
import { containsRtlText } from "@/lib/textDirection";
import { PAGE_MEASURE, rasterizeElement } from "./rasterize";

// The capture's page width rides on the <img> for the walker to size it by.
async function rasterImage(live: HTMLElement, clone: Element, width: string): Promise<Element> {
  const raster = await rasterizeElement(live, width);
  const img = clone.ownerDocument.createElement("img");
  img.setAttribute("src", raster.src);
  img.setAttribute("width", String(raster.width));
  return img;
}

// For PDF export: swap each plugin block (Mermaid, D2) in the clone for its
// light static render (the walker embeds SVG natively; see htmlToPdf), and
// rasterize block math (marked `data-math-display`) to a PNG <img> (vector
// math is #256). Diagrams re-render light so they don't sit as a dark box on the white
// page. A math failure leaves the original node (the walker falls back to the
// LaTeX source); a block whose static render fails becomes its source, so the
// dark on-screen SVG never leaks into the PDF.
export async function preparePdfRichContent(liveBody: Element, clone: Element): Promise<void> {
  const selector = "[data-math-display], [data-fenced-language]";
  const live = liveBody.querySelectorAll<HTMLElement>(selector);
  if (live.length === 0) return;
  const cloned = clone.querySelectorAll(selector);

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
      // Shrink-wrapped to the formula: the block itself spans the window.
      const img = await rasterImage(el, clone, "fit-content");
      img.setAttribute("data-math-display", "");
      cloned[i].replaceWith(img);
    } catch {
      // Leave the math node; the walker falls back to the LaTeX source.
    }
  }
}

// pdfmake positions each word individually left-to-right and does no bidi
// reordering or Arabic shaping (and its bundled font has no Arabic/Hebrew
// glyphs), so RTL text can't render as PDF text; nor can it put an image
// inside a line, so inline math can't either. Any block containing either is
// captured from the live DOM as an image, the same treatment block math gets:
// the webview's rendering is exact. Outermost matching blocks only, so a list
// with one RTL item rasterizes once. Code blocks are not candidates and stay
// selectable text.
const TEXT_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table";

// Plugin blocks are excluded on both sides: their clone may hold a static
// render with a different shape than the live one.
function textBlockCandidates<T extends Element>(root: Element): T[] {
  return Array.from(root.querySelectorAll<T>(TEXT_BLOCK_SELECTOR)).filter(
    (el) => !el.closest("[data-fenced-language]"),
  );
}

export async function rasterizeUndrawableBlocks(liveBody: Element, clone: Element): Promise<void> {
  const live = textBlockCandidates<HTMLElement>(liveBody);
  if (live.length === 0) return;
  const cloned = textBlockCandidates(clone);
  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    // Skip nested matches (an RTL <li> is covered by its list, a table cell's
    // paragraph by its table). A candidate is a descendant, so it has a parent.
    if (el.parentElement!.closest(TEXT_BLOCK_SELECTOR)) continue;
    const hasMath = el.querySelector("[data-math-source]") !== null;
    if (!containsRtlText(el.textContent) && !hasMath) continue;
    try {
      cloned[i].replaceWith(await rasterImage(el, clone, PAGE_MEASURE));
    } catch {
      // Leave the original block; the walker degrades to logical-order text
      // and math to its source.
    }
  }
}

// Copy the live computed text color of each highlighted code span onto the
// matching clone span as an inline style. The clone is detached, so the PDF
// walker can't compute styles itself — it reads these inline colors instead.
// Colors are read with the light theme on, since pages export on white; the
// dark class comes back in the same task, so nothing paints without it.
export function inlineCodeColors(liveBody: Element, clone: Element): void {
  const root = liveBody.ownerDocument.documentElement;
  const isDark = root.classList.contains("dark");
  root.classList.remove("dark");
  try {
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
  } finally {
    root.classList.toggle("dark", isDark);
  }
}
