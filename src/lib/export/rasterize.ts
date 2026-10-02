// Rendering helpers for PDF export. Block math, and text blocks pdfmake cannot
// draw, are captured from the live DOM as raster images (vector math is #256).
// `rasterizeSvgsInHtml` is the fallback for SVGs pdfmake's renderer rejects.

import type { Options } from "html2canvas";
import { decodeSvgDataUrl, toXmlSvg } from "@/lib/svgDataUrl";
import { BODY_FONT_SIZE, CONTENT_WIDTH } from "./svgPdfNode";

const SCALE = 2;
const PT_PER_PX = 0.75;

// Ink spills past its box (Arabic dots and tall letters) and html2canvas
// places some text a few px off, but a capture crops to the box: keep a margin.
const BLEED = 8;

// The box width whose capture, bleed included, spans the page's measure.
export const PAGE_MEASURE = `${CONTENT_WIDTH / PT_PER_PX - 2 * BLEED}px`;

interface Raster {
  src: string;
  // Points on the page, so the capture keeps its on-screen size.
  width: number;
}

// html2canvas inlines every cloned SVG node's live computed style, dark paint
// included: restore the authored style, then resolve the paint in the clone.
function repaintSvgs(doc: Document, live: Element, clone: Element): void {
  const liveNodes = live.querySelectorAll("svg, svg *");
  const nodes = Array.from(clone.querySelectorAll<SVGElement>("svg, svg *"));
  nodes.forEach((node, i) => {
    const authored = liveNodes[i].getAttribute("style");
    if (authored === null) node.removeAttribute("style");
    else node.setAttribute("style", authored);
  });
  // The clone lives in html2canvas's iframe, which always has a window.
  const view = doc.defaultView!;
  // All reads before any write, so the clone restyles once, not per node.
  const resolved = nodes.map((node) => {
    const style = view.getComputedStyle(node);
    return { fill: style.fill, stroke: style.stroke };
  });
  nodes.forEach((node, i) => {
    node.style.fill = resolved[i].fill;
    node.style.stroke = resolved[i].stroke;
  });
}

// Capture a live element as a PNG via html2canvas, laid out at `width` (any
// CSS width, never under the page measure) as the light page draws it. Only
// html2canvas's own clone of the document is restyled.
export async function rasterizeElement(el: HTMLElement, width: string): Promise<Raster> {
  const { default: html2canvas } = await import("html2canvas");
  const options: Partial<Options> = {
    backgroundColor: "#ffffff",
    scale: SCALE,
    logging: false,
    // Clone only the head and the element's own line: html2canvas otherwise
    // copies the whole document, styles and all, for every capture.
    ignoreElements: (node) => {
      const isOnPath = node.contains(el) || el.contains(node);
      return !isOnPath && node.closest("head") === null;
    },
    onclone: (doc, clone) => {
      const root = doc.documentElement;
      root.classList.remove("dark");
      // Prose at pdfmake's body size, so a capture matches the text beside it.
      root.style.setProperty("--glyph-font-size", `${BODY_FONT_SIZE / PT_PER_PX}px`);
      clone.style.width = width;
      // Also beats a table's `min-width: 100%`, and gives a math tag its margin.
      clone.style.minWidth = PAGE_MEASURE;
      repaintSvgs(doc, el, clone);
      const box = clone.getBoundingClientRect();
      // No box (in a collapsed <details>): leave the capture empty.
      if (box.width === 0 || box.height === 0) return;
      // html2canvas reads its crop from these options only after onclone.
      Object.assign(options, {
        x: -BLEED,
        y: -BLEED,
        width: Math.ceil(box.width) + 2 * BLEED,
        height: Math.ceil(box.height) + 2 * BLEED,
      });
    },
  };
  const canvas = await html2canvas(el, options);
  if (canvas.width === 0 || canvas.height === 0) throw new Error("empty capture");
  return { src: canvas.toDataURL("image/png"), width: (canvas.width / SCALE) * PT_PER_PX };
}

/**
 * Replace every `<svg>` element and `data:image/svg+xml` image in an HTML
 * fragment with a PNG `<img>`. This is the PDF exporter's fallback when
 * pdfmake's SVG renderer rejects a vector diagram: the retry must salvage the
 * export, so a per-element failure drops that element rather than aborting.
 * `toPng` is injectable for tests (the default needs a real canvas).
 */
export async function rasterizeSvgsInHtml(
  html: string,
  toPng: (svg: string) => Promise<string> = svgToPng,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("svg"))) {
    try {
      const img = doc.createElement("img");
      img.setAttribute("src", await toPng(toXmlSvg(el.outerHTML)));
      el.replaceWith(img);
    } catch {
      el.remove();
    }
  }
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const markup = decodeSvgDataUrl(img.getAttribute("src") ?? "");
    if (markup === null) continue;
    try {
      img.setAttribute("src", await toPng(toXmlSvg(markup)));
    } catch {
      img.remove();
    }
  }
  return doc.body.innerHTML;
}

export function svgToPng(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const w = image.naturalWidth || 800;
      const h = image.naturalHeight || 600;
      const canvas = document.createElement("canvas");
      canvas.width = w * SCALE;
      canvas.height = h * SCALE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("no 2d context"));
        return;
      }
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg load failed"));
    };
    image.src = url;
  });
}
