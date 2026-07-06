// Rendering helpers for PDF export. Block math is captured from the live DOM
// as a raster image (vector math is #256); diagrams re-render in the light
// theme as SVG strings so the PDF embeds them as true vectors (the on-screen
// SVG bakes in the app theme's colors). `rasterizeSvgsInHtml` is the fallback
// for SVGs pdfmake's renderer rejects.

import { decodeSvgDataUrl, ensureSvgXmlns } from "@/lib/svgDataUrl";

let mermaidId = 0;

// Rasterize a live element (e.g. block math) to a PNG data URI via html2canvas.
export async function rasterizeElement(el: HTMLElement, backgroundColor: string): Promise<string> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, { backgroundColor, scale: 2, logging: false });
  return canvas.toDataURL("image/png");
}

// Re-render a Mermaid source in the light theme with SVG text labels (no
// `<foreignObject>`, which pdfmake's SVG renderer can't draw and which would
// taint a canvas in the raster fallback). Returns the SVG markup. Always
// light, regardless of the app theme.
export async function renderMermaidLightSvg(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, theme: "default", flowchart: { htmlLabels: false } });
  const { svg } = await mermaid.render(`glyph-export-mermaid-${mermaidId++}`, source);
  return svg;
}

// Restore Mermaid's (global) config to the app theme after export-time renders,
// so on-screen diagrams keep their theme and HTML labels.
export async function restoreMermaidTheme(dark: boolean): Promise<void> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    flowchart: { htmlLabels: true },
  });
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
      img.setAttribute("src", await toPng(ensureSvgXmlns(el.outerHTML)));
      el.replaceWith(img);
    } catch {
      el.remove();
    }
  }
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const markup = decodeSvgDataUrl(img.getAttribute("src") ?? "");
    if (markup === null) continue;
    try {
      img.setAttribute("src", await toPng(ensureSvgXmlns(markup)));
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
