// Rendering helpers for PDF export. Block math, and text blocks pdfmake cannot
// draw, are captured from the live DOM as raster images (vector math is #256).
// `rasterizeSvgsInHtml` is the fallback for SVGs pdfmake's renderer rejects.

import { decodeSvgDataUrl, toXmlSvg } from "@/lib/svgDataUrl";
import { CONTENT_WIDTH } from "./svgPdfNode";

const SCALE = 2;
const PT_PER_PX = 0.75;

// The page's measure in CSS px, so a captured text block wraps like the page.
export const PAGE_MEASURE = `${CONTENT_WIDTH / PT_PER_PX}px`;

interface Raster {
  src: string;
  // Points on the page, so the capture keeps its on-screen size.
  width: number;
}

// html2canvas inlines each cloned SVG node's live computed style, dark theme
// included, so KaTeX's radicals would stay light. Resolve the paint again
// against the light clone; every node is cleared first so children inherit.
function repaintSvgs(doc: Document, root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<SVGElement>("svg, svg *"));
  for (const node of nodes) {
    for (const prop of ["color", "fill", "stroke"]) node.style.removeProperty(prop);
  }
  // The clone lives in html2canvas's iframe, which always has a window.
  const view = doc.defaultView!;
  for (const node of nodes) {
    const style = view.getComputedStyle(node);
    node.style.fill = style.fill;
    node.style.stroke = style.stroke;
  }
}

// Capture a live element as a PNG via html2canvas, laid out at `width` (any
// CSS width) in the light theme: pages export on white whatever the app shows.
// Only html2canvas's own clone of the document is restyled.
export async function rasterizeElement(el: HTMLElement, width: string): Promise<Raster> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
    backgroundColor: "#ffffff",
    scale: SCALE,
    logging: false,
    onclone: (doc, clone) => {
      doc.documentElement.classList.remove("dark");
      clone.style.width = width;
      repaintSvgs(doc, clone);
    },
  });
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
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("no 2d context"));
        return;
      }
      ctx.scale(2, 2);
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
