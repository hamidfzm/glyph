import type { TocEntry } from "@/hooks/useTableOfContents";
import {
  rasterizeD2Light,
  rasterizeElement,
  rasterizeMermaidLight,
  restoreMermaidTheme,
} from "./rasterize";
import { buildTocElement } from "./toc";

export interface PrepareOptions {
  entries: TocEntry[];
  includeToc: boolean;
  // Overridable for tests; defaults to the live document.
  doc?: Document;
  // PDF export needs extra work the vector walker can't do itself: inline the
  // rendered syntax-highlight colors onto code spans, and rasterize block math
  // and Mermaid diagrams (which pdfmake can't draw) to embedded images.
  pdf?: boolean;
}

// Rasterize each block-math (`.katex-display`), Mermaid, and D2 diagram in the
// live DOM to a PNG and swap the matching clone node for an <img>. Runs only for
// PDF (HTML/EPUB render these natively). Block math is captured as rendered;
// Mermaid and D2 are re-rendered light so they don't end up as a dark box on the
// white page. On any failure the original node is left so the walker falls back
// (math → LaTeX, diagram → dropped).
async function rasterizeRichContent(liveBody: Element, clone: Element): Promise<void> {
  const selector = ".katex-display, .mermaid-diagram, .d2-diagram";
  const live = liveBody.querySelectorAll<HTMLElement>(selector);
  if (live.length === 0) return;
  const cloned = clone.querySelectorAll(selector);
  const mathBackground = getComputedStyle(liveBody).backgroundColor || "#ffffff";
  let mermaidRendered = false;

  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    try {
      let dataUrl: string;
      if (el.classList.contains("mermaid-diagram")) {
        const source = el.getAttribute("data-mermaid-source");
        if (!source) continue; // can't re-render without the source; leave as-is
        dataUrl = await rasterizeMermaidLight(source);
        mermaidRendered = true;
      } else if (el.classList.contains("d2-diagram")) {
        const source = el.getAttribute("data-d2-source");
        if (!source) continue; // can't re-render without the source; leave as-is
        dataUrl = await rasterizeD2Light(source);
      } else {
        dataUrl = await rasterizeElement(el, mathBackground);
      }
      const img = clone.ownerDocument.createElement("img");
      img.setAttribute("src", dataUrl);
      cloned[i].replaceWith(img);
    } catch {
      // Leave the original node; the walker falls back.
    }
  }

  if (mermaidRendered) {
    await restoreMermaidTheme(liveBody.ownerDocument.documentElement.classList.contains("dark"));
  }
}

// Copy the live computed text color of each highlighted code span onto the
// matching clone span as an inline style. The clone is detached, so the PDF
// walker can't compute styles itself — it reads these inline colors instead.
function inlineCodeColors(liveBody: Element, clone: Element): void {
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

export interface PreparedContent {
  // Cleaned inner HTML of the rendered body.
  html: string;
  // The wrapper class to reuse so bundled styles apply (markdown vs notebook).
  bodyClass: "markdown-body" | "notebook-body";
}

// Elements that exist only for interactive use in the app and should never
// appear in an exported document.
const STRIP_SELECTOR = ".code-copy-button, [data-export-ignore]";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Inline an <img> as a base64 data URI so the export is portable and offline.
// Already-inlined (data:) images are left alone; a fetch failure leaves the
// original src untouched rather than dropping the image.
async function embedImage(img: HTMLImageElement): Promise<void> {
  const src = img.getAttribute("src");
  if (!src || src.startsWith("data:")) return;
  try {
    const res = await fetch(src);
    if (!res.ok) return;
    img.setAttribute("src", await blobToDataUrl(await res.blob()));
  } catch {
    // Leave the original src; the reader may still resolve it.
  }
}

/**
 * Clone the rendered document body (markdown or notebook), strip app-only UI,
 * make task checkboxes non-interactive, inline images, and optionally prepend a
 * table of contents. Returns the cleaned inner HTML plus its wrapper class, or
 * `null` when there is no rendered body to export.
 *
 * Reusing the live DOM (rather than re-parsing markdown) means KaTeX math,
 * highlighted code, GFM tables, alerts, Mermaid SVGs, and notebook cells come
 * through exactly as the user sees them.
 */
export async function prepareContent({
  entries,
  includeToc,
  doc = document,
  pdf = false,
}: PrepareOptions): Promise<PreparedContent | null> {
  const body = doc.querySelector<HTMLElement>(".markdown-body, .notebook-body");
  if (!body) return null;
  const bodyClass = body.classList.contains("notebook-body") ? "notebook-body" : "markdown-body";

  const clone = body.cloneNode(true) as HTMLElement;
  if (pdf) {
    inlineCodeColors(body, clone);
    await rasterizeRichContent(body, clone);
  }
  for (const el of Array.from(clone.querySelectorAll(STRIP_SELECTOR))) {
    el.remove();
  }

  // Task-list checkboxes are interactive in the app; an exported document must
  // show their state without being togglable.
  for (const checkbox of Array.from(clone.querySelectorAll('input[type="checkbox"]'))) {
    checkbox.setAttribute("disabled", "");
  }

  // External links should open in a new tab/window from the exported file.
  // The `a[href]` selector guarantees the attribute is present.
  for (const anchor of Array.from(clone.querySelectorAll("a[href]"))) {
    if (/^https?:/i.test(anchor.getAttribute("href")!)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }

  await Promise.all(Array.from(clone.querySelectorAll("img")).map(embedImage));

  if (includeToc && entries.length > 0) {
    clone.insertBefore(buildTocElement(entries), clone.firstChild);
  }

  return { html: clone.innerHTML, bodyClass };
}
